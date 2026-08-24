import { Controller, Get, Post, Body, Param, Query, Req, NotFoundException, BadRequestException, ForbiddenException, HttpCode, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductRepository } from '../product/product.repository';
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';
import { STORE_PORT, StorePort } from '../store/ports/store.port';
import { OrderRepository } from './order.repository';
import { OrderDocument } from './schemas/order.schema';
import { OrderQueryService } from './query/order-query.service';
import { OrderLifecycleService } from './lifecycle/order-lifecycle.service';
import { OrderFulfillmentService } from './fulfillment/order-fulfillment.service';
import { OrderCancellationService } from './lifecycle/order-cancellation.service';
import { OrderIngestService } from './ingest/order-ingest.service';
import { OrderMetricsService } from './observability/order-metrics.service';
import { MarketplaceOrderService } from '../marketplace/services/marketplace-order.service';
import { SaleNotificationReconcilerService } from './services/sale-notification-reconciler.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { OrderLabelService } from './services/order-label.service';
import {
    BalcaoOrderDraftModel,
    BalcaoOrderDraftDocument,
} from './schemas/balcao-order-draft.schema';

interface CreateBalcaoOrderItemDto {
    productId: string;
    quantity: number;
    unitPrice: number;
}

@Controller('orders')
export class OrderController {
    constructor(
        private readonly orderQuery: OrderQueryService,
        private readonly orderLifecycle: OrderLifecycleService,
        private readonly orderFulfillment: OrderFulfillmentService,
        private readonly cancellationService: OrderCancellationService,
        private readonly ingest: OrderIngestService,
        private readonly orderRepository: OrderRepository,
        private readonly productRepository: ProductRepository,
        private readonly metrics: OrderMetricsService,
        private readonly marketplaceOrderService: MarketplaceOrderService,
        private readonly saleNotificationReconciler: SaleNotificationReconcilerService,
        @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
        private readonly marketplaceConfigCache: MarketplaceConfigCacheService,
        private readonly orderLabel: OrderLabelService,
        @InjectModel(BalcaoOrderDraftModel.name)
        private readonly balcaoDraftModel: Model<BalcaoOrderDraftDocument>,
        @Inject(STORE_PORT) private readonly storePort: StorePort,
    ) { }

    /**
     * storeId nunca vem do client — sempre de req.user.storeId (mesmo padrão de
     * StockController/StoreListingController), para que uma loja não veja pedidos de outra.
     */
    private requireStoreId(req: any): string {
        const storeId = req?.user?.storeId;
        if (!storeId) {
            throw new BadRequestException('Usuário sem loja configurada — não é possível consultar pedidos.');
        }
        return storeId;
    }

    /**
     * Impede que uma loja acesse/opere pedido de outra loja pelo id — mesma
     * fronteira de req.user.storeId → Store.marketplaceAccounts usada em findAll,
     * agora aplicada por pedido individual. Pedido sem accountId (legado
     * single-client) é tratado como pertencente à loja default e liberado.
     */
    private async assertOwnsOrder(req: any, order: OrderDocument): Promise<void> {
        const storeId = this.requireStoreId(req);
        if (!order.accountId) return;
        const store = await this.storePort.findById(storeId);
        const accountIds = new Set((store?.marketplaceAccounts ?? []).map((a) => a.accountId));
        if (!accountIds.has(order.accountId)) {
            throw new ForbiddenException('Pedido não pertence à sua loja.');
        }
    }

    /**
     * Cria um pedido de venda balcão (loja física). Entra pelo mesmo pipeline de
     * ingest usado por marketplaces externos — via RocketOrderAdapter, que lê o
     * rascunho gravado aqui. Ver docs/superpowers/specs/2026-08-20-balcao-order-design.md.
     */
    @Post('balcao')
    @HttpCode(201)
    async createBalcaoOrder(@Body() body: { items: CreateBalcaoOrderItemDto[] }) {
        if (!body?.items?.length) {
            throw new BadRequestException('Informe ao menos um item.');
        }
        for (const item of body.items) {
            if (!item.productId || !Types.ObjectId.isValid(item.productId)) {
                throw new BadRequestException(`productId inválido: ${item.productId}`);
            }
            if (!item.quantity || item.quantity <= 0) {
                throw new BadRequestException(`Quantidade inválida para o produto ${item.productId}`);
            }
        }

        // Nome, não tag: é a chave usada por MarketplaceAdapterRegistry.getOrderAdapter(mkt.name)
        // — mesmo padrão de RocketProductAdapter, que já publica sob este marketplace.
        const marketplace = await this.marketplaceConfigCache.getByName('Rocket');
        if (!marketplace) {
            throw new BadRequestException(
                'Marketplace interno "Rocket" não encontrado (esperado name="Rocket" em marketplaces).',
            );
        }

        // accountId é obrigatório para a resolução fiscal (Store.marketplaceAccounts →
        // FiscalChannel) — sem ele o Order fica sem loja emissora resolvível.
        const rocketAccount = (marketplace.accounts ?? []).find(a => a.isDefault) ?? marketplace.accounts?.[0];
        if (!rocketAccount) {
            throw new BadRequestException(
                'Marketplace "Rocket" não tem nenhuma conta cadastrada — configure uma em Configurações > Marketplaces.',
            );
        }
        const accountId = String((rocketAccount as any)._id);

        const productIds = body.items.map(i => i.productId);
        const products = await this.productRepository.findSummariesByIds(productIds);
        const titleById = new Map(products.map(p => [String(p._id), p.name]));

        const externalId = `BALCAO-${Date.now()}`;
        await this.balcaoDraftModel.create({
            externalId,
            status: 'pending',
            data: {
                items: body.items.map(i => ({
                    productId: i.productId,
                    title: titleById.get(i.productId) || '',
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                })),
            },
        });

        await this.ingest.ingest(externalId, marketplace.id, 'manual', accountId);

        const order = await this.orderRepository.findByExternalId(externalId);
        if (!order) {
            throw new BadRequestException('Falha ao criar pedido balcão — verifique os produtos informados.');
        }
        return { orderId: order._id.toString(), externalId };
    }

    /**
     * Reenvia a notificação WhatsApp de uma venda. Aceita externalId ou ObjectId.
     * (Migrado de WhatsAppController — reenvio é lógica de negócio de order.)
     */
    @Post('/:orderId/resend-notification')
    async resendNotification(@Param('orderId') orderId: string) {
        return this.saleNotificationReconciler.resend(orderId);
    }

    /**
     * Attach a fiscal document (NFe XML) to the order on the marketplace.
     * Moved here from MarketplaceController so marketplace no longer depends on order
     * (breaks the marketplace<->order cycle). Order already depends on marketplace.
     */
    @Post('/marketplaces/:marketplaceId/orders/:orderId/attach-fiscal')
    async attachFiscalDocument(
        @Param('marketplaceId') marketplaceId: string,
        @Param('orderId') orderId: string,
    ) {
        const result = await this.orderQuery.getOrder(orderId);
        if (result.isFailure) throw new NotFoundException(result.error);
        const order = result.getValue();

        if (!order.fiscalDocuments || order.fiscalDocuments.length === 0) {
            throw new NotFoundException('Nenhum documento fiscal encontrado para este pedido.');
        }

        const fiscalDoc = order.fiscalDocuments[order.fiscalDocuments.length - 1];
        const xmlContent = fiscalDoc.xml || fiscalDoc.xmlSigned;
        if (!xmlContent) {
            throw new BadRequestException('Conteúdo do XML não encontrado no documento fiscal.');
        }

        const packId = (order as any).packId || undefined;
        return this.marketplaceOrderService.attachFiscalDocument(
            order.externalId,
            marketplaceId,
            xmlContent,
            { packId },
        );
    }

    @Get('reconcile/health')
    reconcileHealth() {
        return this.metrics.snapshot();
    }

    @Get('cancellations/inconsistent')
    async listInconsistentCancellations(@Query('days') days = 30) {
        return this.cancellationService.findInconsistentCancellations(Number(days));
    }

    @Post('cancellations/fix-inconsistent')
    @HttpCode(200)
    async fixInconsistentCancellations(@Query('days') days = 30) {
        return this.cancellationService.fixInconsistentCancellations(Number(days));
    }

    @Post(':id/reprocess-cancellation')
    @HttpCode(200)
    async reprocessCancellation(@Param('id') id: string) {
        const order = Types.ObjectId.isValid(id)
            ? await this.orderRepository.findById(id)
            : await this.orderRepository.findByExternalId(id);
        if (!order) throw new NotFoundException(`Order ${id} not found`);
        if ((order.status ?? '').toLowerCase() !== 'cancelled') {
            throw new BadRequestException(`Order ${order.externalId} is not cancelled (status: ${order.status})`);
        }
        const result = await this.cancellationService.process(order, {}, 'webhook');
        return { order: order.externalId, ...result };
    }

    @Post('syncc')
    @HttpCode(202)
    async syncOrder(@Body() body: { externalId: string; marketplaceId: string }) {
        if (!body.externalId || !body.marketplaceId) {
            throw new BadRequestException('externalId and marketplaceId are required');
        }
        await this.ingest.ingest(body.externalId, body.marketplaceId, 'manual');
        return { message: 'Order sync accepted', status: 'processing', externalId: body.externalId };
    }

    @Get('debug-stock/:externalId')
    async debugStock(@Param('externalId') externalId: string) {
        const trimmedId = externalId.trim();
        const movements = await this.stockQuery.findExistingReferences([trimmedId]);
        const directFind = await this.stockQuery.referenceExists(trimmedId);
        return {
            input: externalId,
            trimmed: trimmedId,
            repo_findMovementsByReferences: movements,
            repo_existsMovementReference: directFind,
            message: movements.length > 0 ? 'LOGIC WORKING' : 'LOGIC FAILING',
        };
    }

    @Get()
    async findAll(
        @Req() req: any,
        @Query('page') page = 1,
        @Query('limit') limit = 50,
        @Query('offset') offset?: number,
        @Query('q') search?: string,
    ) {
        const storeId = this.requireStoreId(req);
        const store = await this.storePort.findById(storeId);
        const accountIds = (store?.marketplaceAccounts ?? []).map((a) => a.accountId);

        const actualOffset = offset !== undefined ? offset : (page - 1) * limit;
        return this.orderQuery.findAll(actualOffset, limit, search, accountIds);
    }

    @Get(':id')
    async findOne(@Req() req: any, @Param('id') id: string) {
        const result = await this.orderQuery.getOrder(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        await this.assertOwnsOrder(req, result.getValue());
        return result.getValue();
    }

    @Post(':id/note')
    async addNote(@Req() req: any, @Param('id') id: string, @Body() body: { message: string }) {
        const order = await this.orderQuery.getOrder(id);
        if (order.isFailure) throw new NotFoundException(order.error);
        await this.assertOwnsOrder(req, order.getValue());
        const result = await this.orderLifecycle.addNote(id, body.message);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    /**
     * Avanço manual de status (loja virtual B2C) — não há rastreamento de transportadora
     * integrado ainda, então o time interno marca Enviado/Entregue manualmente no admin.
     */
    @Post(':id/shipping-status')
    async updateShippingStatus(
        @Req() req: any,
        @Param('id') id: string,
        @Body() body: { status: 'SHIPPED' | 'DELIVERED'; userId?: string },
    ) {
        const order = await this.orderQuery.getOrder(id);
        if (order.isFailure) throw new NotFoundException(order.error);
        await this.assertOwnsOrder(req, order.getValue());
        const result = await this.orderLifecycle.updateShippingStatus(id, body.status, body.userId);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Get(':id/separation')
    async getSeparationList(@Req() req: any, @Param('id') id: string) {
        const result = await this.orderQuery.getOrder(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        await this.assertOwnsOrder(req, result.getValue());
        return this.orderFulfillment.getSeparationList(result.getValue());
    }

    @Get(':id/label')
    async getShippingLabel(@Req() req: any, @Param('id') id: string) {
        const order = await this.orderQuery.getOrder(id);
        if (order.isFailure) throw new NotFoundException(order.error);
        await this.assertOwnsOrder(req, order.getValue());
        return this.orderLabel.getLabel(id);
    }

    @Post(':id/enrich-billing')
    async enrichBilling(@Req() req: any, @Param('id') id: string) {
        const res = await this.orderQuery.getOrder(id);
        if (res.isFailure) throw new BadRequestException(res.error);
        await this.assertOwnsOrder(req, res.getValue());
        const result = await this.orderFulfillment.enrichBillingData(res.getValue());
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Get('external/:id')
    async findByExternalId(@Req() req: any, @Param('id') id: string) {
        const result = await this.orderQuery.getOrderByExternalId(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        await this.assertOwnsOrder(req, result.getValue());
        return result.getValue();
    }

    @Post(':id/picking/validate')
    async validatePicking(@Req() req: any, @Param('id') id: string, @Body() body: { code: string }) {
        const res = await this.orderQuery.getOrder(id);
        if (res.isFailure) throw new BadRequestException(res.error);
        await this.assertOwnsOrder(req, res.getValue());
        const result = await this.orderFulfillment.validatePicking(res.getValue(), body.code);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Post(':id/ignore')
    async ignoreOrder(@Req() req: any, @Param('id') id: string, @Body() body: { userId?: string }) {
        const order = await this.orderQuery.getOrder(id);
        if (order.isFailure) throw new NotFoundException(order.error);
        await this.assertOwnsOrder(req, order.getValue());
        const result = await this.orderLifecycle.ignoreOrder(id, body.userId || 'admin');
        if (result.isFailure) throw new BadRequestException(result.error);
        return { success: true };
    }

    @Post(':id/complete-picking')
    async completePicking(@Req() req: any, @Param('id') id: string, @Body() body: { pickedItems: Record<string, number> }) {
        const res = await this.orderQuery.getOrder(id);
        if (res.isFailure) throw new BadRequestException(res.error);
        await this.assertOwnsOrder(req, res.getValue());
        const result = await this.orderFulfillment.completePicking(res.getValue(), body.pickedItems);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Post(':id/retry-logistics')
    async retryLogistics(@Req() req: any, @Param('id') id: string, @Body() body: { userId?: string }) {
        const res = await this.orderQuery.getOrder(id);
        if (res.isFailure) throw new BadRequestException(res.error);
        await this.assertOwnsOrder(req, res.getValue());
        const result = await this.orderFulfillment.retryLogistics(res.getValue(), body.userId || 'admin');
        if (result.isFailure) throw new BadRequestException(result.error);
        return { success: true };
    }
}

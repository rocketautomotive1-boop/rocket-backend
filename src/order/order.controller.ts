import { Controller, Get, Post, Body, Param, Query, NotFoundException, BadRequestException, HttpCode, Inject } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProductRepository } from '../product/product.repository';
import { STOCK_QUERY_PORT, StockQueryPort } from '../stock/ports/stock-query.port';
import { OrderRepository } from './order.repository';
import { OrderQueryService } from './query/order-query.service';
import { OrderLifecycleService } from './lifecycle/order-lifecycle.service';
import { OrderFulfillmentService } from './fulfillment/order-fulfillment.service';
import { OrderCancellationService } from './lifecycle/order-cancellation.service';
import { OrderIngestService } from './ingest/order-ingest.service';
import { OrderMetricsService } from './observability/order-metrics.service';
import { MarketplaceOrderService } from '../marketplace/services/marketplace-order.service';
import { SaleNotificationReconcilerService } from './services/sale-notification-reconciler.service';

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
    ) { }

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
        @Query('page') page = 1,
        @Query('limit') limit = 50,
        @Query('offset') offset?: number,
        @Query('q') search?: string,
    ) {
        const actualOffset = offset !== undefined ? offset : (page - 1) * limit;
        return this.orderQuery.findAll(actualOffset, limit, search);
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        const result = await this.orderQuery.getOrder(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        return result.getValue();
    }

    @Post(':id/note')
    async addNote(@Param('id') id: string, @Body() body: { message: string }) {
        const result = await this.orderLifecycle.addNote(id, body.message);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Get(':id/separation')
    async getSeparationList(@Param('id') id: string) {
        const result = await this.orderQuery.getOrder(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        return this.orderFulfillment.getSeparationList(result.getValue());
    }

    @Post(':id/enrich-billing')
    async enrichBilling(@Param('id') id: string) {
        const res = await this.orderQuery.getOrder(id);
        if (res.isFailure) throw new BadRequestException(res.error);
        const result = await this.orderFulfillment.enrichBillingData(res.getValue());
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Get('external/:id')
    async findByExternalId(@Param('id') id: string) {
        const result = await this.orderQuery.getOrderByExternalId(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        return result.getValue();
    }

    @Post(':id/picking/validate')
    async validatePicking(@Param('id') id: string, @Body() body: { code: string }) {
        const res = await this.orderQuery.getOrder(id);
        if (res.isFailure) throw new BadRequestException(res.error);
        const result = await this.orderFulfillment.validatePicking(res.getValue(), body.code);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Post(':id/ignore')
    async ignoreOrder(@Param('id') id: string, @Body() body: { userId?: string }) {
        const result = await this.orderLifecycle.ignoreOrder(id, body.userId || 'admin');
        if (result.isFailure) throw new BadRequestException(result.error);
        return { success: true };
    }

    @Post(':id/complete-picking')
    async completePicking(@Param('id') id: string, @Body() body: { pickedItems: Record<string, number> }) {
        const res = await this.orderQuery.getOrder(id);
        if (res.isFailure) throw new BadRequestException(res.error);
        const result = await this.orderFulfillment.completePicking(res.getValue(), body.pickedItems);
        if (result.isFailure) throw new BadRequestException(result.error);
        return result.getValue();
    }

    @Post(':id/retry-logistics')
    async retryLogistics(@Param('id') id: string, @Body() body: { userId?: string }) {
        const res = await this.orderQuery.getOrder(id);
        if (res.isFailure) throw new BadRequestException(res.error);
        const result = await this.orderFulfillment.retryLogistics(res.getValue(), body.userId || 'admin');
        if (result.isFailure) throw new BadRequestException(result.error);
        return { success: true };
    }
}

import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceRegistryService } from './marketplace-registry.service';
import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { StandardOrder } from '../model/order.interface';
// Direct OrderModel access (schema-only import, NOT the order module) so marketplace does not
// depend on OrderModule — breaks the marketplace<->order cycle.
import { OrderModel, OrderDocument } from '../../order/schemas/order.schema';
import { ProductService } from '../../product/product.service';
import { ProductRepository } from '../../product/product.repository';
import { IgnoredOrderModel, IgnoredOrderDocument } from '../schemas/ignored-order.schema';
import { ListingService } from '../../listing/listing.service'; // [NEW]
import { STORE_PORT, StorePort } from '../../store/ports/store.port';

@Injectable()
export class MarketplaceOrderService {
    private readonly logger = new Logger(MarketplaceOrderService.name);

    constructor(
        private readonly registryService: MarketplaceRegistryService,
        private readonly adapterRegistry: MarketplaceAdapterRegistry,
        private readonly authService: MarketplaceAuthService,
        @InjectModel(OrderModel.name)
        private readonly orderModel: Model<OrderDocument>,
        @Inject(forwardRef(() => ProductService))
        private readonly productService: ProductService,
        private readonly productRepository: ProductRepository,
        @InjectModel(IgnoredOrderModel.name)
        private readonly ignoredOrderModel: Model<IgnoredOrderDocument>,
        private readonly listingService: ListingService, // [NEW]
        @Inject(STORE_PORT) private readonly storePort: StorePort,
    ) { }

    async attachFiscalDocument(
        orderId: string,
        marketplaceId: string,
        xmlContent: string,
        options?: { packId?: string; pdfBase64?: string; accountId?: string },
    ): Promise<any> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        try {
            const adapter = this.adapterRegistry.getOrderAdapter(marketplace.name);
            if (adapter.uploadInvoice) {
                const result = await adapter.uploadInvoice(orderId, xmlContent, options);
                await this.orderModel.updateOne(
                    { externalId: orderId },
                    { $set: { fiscalAttachedAt: new Date() }, $unset: { fiscalAttachError: '' } },
                ).exec();
                return result;
            }
        } catch (e) {
            this.logger.warn(`uploadInvoice not supported for ${marketplace.name}: ${e.message}`);
            await this.orderModel.updateOne(
                { externalId: orderId },
                { $set: { fiscalAttachError: e.message } },
            ).exec();
        }

        throw new BadRequestException(`Fiscal Document upload failed or not supported for ${marketplace.name}`);
    }

    /**
     * Fonte única de leitura: banco local (Order collection), nunca live via
     * marketplace. O banco já é mantido atualizado por webhook (orders_v2,
     * latência de segundos) + OrderReconciler (delta, latência de minutos) —
     * não há mais motivo para servir a listagem ao vivo da API do ML/Shopee/etc.
     * Ver docs/superpowers/specs/2026-08-26-order-list-single-source-design.md.
     */
    async getAllOrders(
        storeId: string,
        params?: { status?: string; limit?: number; offset?: number; q?: string }
    ): Promise<StandardOrder[]> {
        const store = await this.storePort.findById(storeId);
        const accountIds = (store?.marketplaceAccounts ?? []).map((a) => a.accountId);
        if (accountIds.length === 0) return [];

        const orders = await this.findScopedOrders({
            accountIds,
            search: params?.q,
            status: params?.status,
            limit: params?.limit,
            offset: params?.offset,
        });

        return orders.map(o => this.normalizeToStandardOrder(o));
    }

    async getOrders(
        marketplaceId: string,
        storeId: string,
        params?: { status?: string; limit?: number; offset?: number }
    ): Promise<StandardOrder[]> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        const accountIds = await this.storePort.resolveAccountIds(storeId, (marketplace as any).tag);
        if (accountIds.length === 0) return [];

        const orders = await this.findScopedOrders({
            accountIds,
            marketplaceId: String(marketplace._id),
            status: params?.status,
            limit: params?.limit,
            offset: params?.offset,
        });

        return orders.map(o => this.normalizeToStandardOrder(o));
    }

    async getOrderDetails(orderId: string, marketplaceId: string, options?: { skipEnrichment?: boolean }): Promise<StandardOrder> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        const adapter = this.adapterRegistry.getOrderAdapter(marketplace.name);
        let order = await adapter.getOrderDetails(orderId);

        if (order && !options?.skipEnrichment) {
            order = await this.enrichOrder(order);
        }

        return order;
    }

    async enrichOrder(order: StandardOrder): Promise<StandardOrder> {
        if (!order || !order.items) return order;

        for (const item of order.items) {
            const itemProductId = item.productId || item.internalProduct?._id;
            if (itemProductId) {
                const internalProduct = await this.productRepository.findById(String(itemProductId));
                if (internalProduct) {
                    const attributes = await this.productService.getAttributes(String(internalProduct._id));

                    item.internalProduct = {
                        ...(internalProduct.toObject ? internalProduct.toObject() : internalProduct),
                        ncm: attributes.ncm,
                        origin: attributes.origin,
                        unit: attributes.unit
                    };

                    item.ncm = attributes.ncm?.code;
                    item.cfop = attributes.cfop || '5102';
                    item.uCom = attributes.unit?.code || 'UN';
                    item.uTrib = attributes.unit?.code || 'UN';
                    item.prod_orig = Number(attributes.origin) || 0;
                }
            }
        }
        return order;
    }

    async ignoreOrder(marketplaceId: string, orderId: string): Promise<any> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        const mId = marketplace._id;
        const exists = await this.ignoredOrderModel.findOne({ orderId, marketplaceId: mId }).exec();
        if (exists) return exists;

        const ignored = new this.ignoredOrderModel({
            orderId,
            marketplaceId: mId
        });
        return ignored.save();
    }

    hasOrderAdapter(marketplaceName: string): boolean {
        return this.adapterRegistry.hasOrderAdapter(marketplaceName);
    }

    // syncOrdersToMovements/processOrdersSync (bulk-sync legado, dedução manual de movimentos
    // pré-StockModule) foram removidos. A reconciliação de pedidos perdidos pelo webhook vive
    // no OrderReconciler (cursor + delta) → OrderIngestService.ingest → OrderSyncPipeline.

    async getBillingInfo(billingId: string, marketplaceId: string): Promise<any> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new Error('Marketplace not found');

        try {
            const adapter = this.adapterRegistry.getOrderAdapter(marketplace.name);
            if (adapter.getBillingInfo) {
                return await adapter.getBillingInfo(billingId);
            }
        } catch (e) {
            this.logger.warn(`Adapter check failed: ${e.message}`);
        }

        throw new BadRequestException('Billing info not supported');
    }

    private normalizeToStandardOrder(order: any): StandardOrder {
        const raw = order.toObject ? order.toObject() : order;

        // Date Normalization
        const dateCreated = raw.date_created || raw.createdAt || new Date().toISOString();

        // Total Normalization
        const totalAmount = raw.total_amount ?? raw.totalAmount ?? raw.total ?? 0;

        // Buyer Normalization
        const buyer = raw.buyer || raw.customer || raw.payer || {};
        const normalizedBuyer = {
            id: buyer.id || buyer._id || 0,
            nickname: buyer.nickname || buyer.name || 'Comprador',
            first_name: buyer.first_name || (buyer.name ? buyer.name.split(' ')[0] : 'Comprador'),
            last_name: buyer.last_name || (buyer.name ? buyer.name.split(' ').slice(1).join(' ') : ''),
            name: buyer.name || buyer.nickname
        };

        return {
            ...raw,
            // StandardOrder.id é o ID do pedido NO MARKETPLACE (externalId no banco local),
            // não o ObjectId interno do Mongo — mesmo contrato usado pelo fetch ao vivo.
            id: String(raw.externalId || raw.id || raw._id),
            marketplaceId: String(raw.marketplaceId),
            date_created: new Date(dateCreated).toISOString(),
            total_amount: Number(totalAmount),
            buyer: normalizedBuyer,
            status: raw.status || 'unknown'
        };
    }
    /**
     * Fonte única de leitura de pedidos para a listagem (direct model query — sem
     * depender de OrderModule/OrderRepository, que criaria o ciclo marketplace↔order
     * que este service já evita por design, ver import de OrderModel no topo do arquivo).
     * Espelha os filtros de OrderRepository.findAll (accountId/marketplaceId/status/search).
     */
    private async findScopedOrders(params: {
        accountIds: string[];
        marketplaceId?: string;
        status?: string;
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<OrderDocument[]> {
        const filter: any = { accountId: { $in: params.accountIds } };
        if (params.marketplaceId) filter.marketplaceId = params.marketplaceId;
        if (params.status) filter.status = params.status;
        if (params.search) {
            const regex = new RegExp(params.search, 'i');
            filter.$or = [
                { externalId: regex },
                { 'customer.name': regex },
                { 'customer.email': regex },
                { 'items.title': regex },
            ];
        }

        return this.orderModel.find(filter)
            .sort({ createdAt: -1 })
            .skip(params.offset || 0)
            .limit(params.limit || 50)
            .populate('fiscalDocuments')
            .exec();
    }
}

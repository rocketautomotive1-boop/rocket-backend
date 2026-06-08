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
    ) { }

    async attachFiscalDocument(
        orderId: string,
        marketplaceId: string,
        xmlContent: string,
        options?: { packId?: string; pdfBase64?: string },
    ): Promise<any> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        try {
            const adapter = this.adapterRegistry.getOrderAdapter(marketplace.name);
            if (adapter.uploadInvoice) {
                return await adapter.uploadInvoice(orderId, xmlContent, options);
            }
        } catch (e) {
            this.logger.warn(`uploadInvoice not supported for ${marketplace.name}: ${e.message}`);
        }

        throw new BadRequestException(`Fiscal Document upload failed or not supported for ${marketplace.name}`);
    }

    async getAllOrders(
        params?: { status?: string; limit?: number; offset?: number; includeSyncStatus?: boolean; syncStatus?: string; q?: string }
    ): Promise<StandardOrder[]> {
        const marketplaces = await this.registryService.findAll();
        const enabledMarketplaces = marketplaces
            .filter(m => m.enabled && this.adapterRegistry.hasOrderAdapter(m.name));
        this.logger.log(`Enabled Marketplaces for order fetch: [${enabledMarketplaces.map(m => m.name).join(', ')}]`);

        const results = await Promise.allSettled(
            enabledMarketplaces.map(async (marketplace) => {
                try {
                    this.logger.log(`Fetching orders from ${marketplace.name} (ID: ${marketplace._id})...`);
                    const adapter = this.adapterRegistry.getOrderAdapter(marketplace.name);
                    const mId = marketplace._id;

                    let orders = await adapter.getOrders({
                        status: params?.status,
                        limit: params?.limit,
                        offset: params?.offset,
                    });

                    this.logger.log(`Fetched ${orders.length} orders from ${marketplace.name}.`);

                    if (!orders.length) return [];

                    orders = orders.map(o => ({ ...o, marketplaceId: String(mId) }));

                    if (params?.includeSyncStatus || params?.syncStatus) {
                        return await this.enrichOrdersWithSyncStatus(orders, params?.syncStatus);
                    }

                    return orders;
                } catch (error) {
                    this.logger.error(`Failed to fetch orders from ${marketplace.name}: ${error.message}`, error.stack);
                    return [];
                }
            })
        );

        const finalOrders = results
            .filter(r => r.status === 'fulfilled')
            .map(r => (r as PromiseFulfilledResult<StandardOrder[]>).value)
            .flat()
            .filter(Boolean)
            .map(o => this.normalizeToStandardOrder(o));

        // Lazy Sync: Save fetched orders to DB in background
        // DISABLED: User requires manual sync trigger. Auto-sync was causing premature 'synced' status with incomplete data.
        // this.saveOrdersToDb(finalOrders).catch(err => this.logger.error(`Lazy sync failed: ${err.message}`));

        // Hybrid Search: If searching, also get matches from Local DB
        if (params?.q) {
            try {
                // Determine pagination for local search:
                // If offset=0 (first page), we search local.
                // If the user provided a search term, we prioritize finding matches.
                // Repo method: findAll(offset, limit, search)
                const localMatches = await this.findLocalOrders(params.q);
                const localOrders = localMatches.filter(Boolean).map(o => this.normalizeToStandardOrder(o));

                // Merge Live + Local (Deduplicate by ID or ExternalID)
                const liveIds = new Set(finalOrders.map(o => o.id));
                localOrders.forEach(local => {
                    if (!liveIds.has(local.id)) {
                        finalOrders.push(local);
                    }
                });
                this.logger.log(`Hybrid Search: Merged ${localMatches.length} local matches.`);
            } catch (error) {
                this.logger.error(`Hybrid Search failed: ${error.message}`);
            }
        }

        // Debug: Log composition
        const composition = finalOrders.reduce((acc, order) => {
            acc[order.marketplaceId] = (acc[order.marketplaceId] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        this.logger.log(`Aggregated ${finalOrders.length} orders from All sources. Composition: ${JSON.stringify(composition)}`);

        // Final Search Filter: Ensure ALL returned orders match the query
        // (Adapters might have returned "Recent" orders ignoring the search param)
        if (params?.q) {
            const term = params.q.toLowerCase();
            return finalOrders.filter(o =>
                o.id.toLowerCase().includes(term) ||
                o.buyer?.name?.toLowerCase().includes(term) ||
                o.items?.some(i => i.title.toLowerCase().includes(term) || i.sku?.toLowerCase().includes(term))
            ).sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());
        }

        return finalOrders.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());
    }

    async getOrders(
        marketplaceId: string,
        params?: { status?: string; limit?: number; offset?: number; includeSyncStatus?: boolean; syncStatus?: string }
    ): Promise<StandardOrder[]> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException('Marketplace not found');

        const adapter = this.adapterRegistry.getOrderAdapter(marketplace.name);
        let orders = await adapter.getOrders({
            status: params?.status,
            limit: params?.limit,
            offset: params?.offset
        }) as StandardOrder[];

        if (!orders.length) return [];

        const mId = marketplace._id;
        orders = orders.map(o => ({ ...o, marketplaceId: String(mId) }));

        if (params?.includeSyncStatus || params?.syncStatus) {
            return await this.enrichOrdersWithSyncStatus(orders, params?.syncStatus);
        }

        return orders;
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

    async enrichOrdersWithSyncStatus(orders: StandardOrder[], syncStatusfilter?: string): Promise<StandardOrder[]> {
        // Collect external IDs (or IDs depending on what the adapter returns as 'id')
        // Adapter returns 'id' as the marketplace ID (externalId)
        const externalIds = orders.map(o => String(o.id));

        // Check actual Order Collection (covers both Stock-Synced and Admin-Synced)
        const existingOrders = await this.orderModel.find(
            { externalId: { $in: externalIds } },
            { externalId: 1, syncedAt: 1, marketplaceId: 1, status: 1 },
        ).exec();

        // Create existence map
        const existingMap = new Map<string, any>();
        existingOrders.forEach(o => {
            existingMap.set(String(o.externalId), o);
        });

        // Also check movements as fallback/redundancy (optional, but Order existence is the source of truth now)
        // We can just rely on Order existence since sync() creates the order.

        const enriched = orders.map(order => {
            const localOrder = existingMap.get(String(order.id));
            const isSynced = !!localOrder;

            return {
                ...order,
                syncStatus: isSynced ? 'synced' : 'pending',
                isSynced: isSynced,
                syncedAt: localOrder?.syncedAt ? new Date(localOrder.syncedAt).toISOString() : undefined
            };
        });

        if (syncStatusfilter) {
            return enriched.filter(o => o.syncStatus === syncStatusfilter);
        }
        return enriched;
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

    async syncOrdersToMovements(
        marketplaceId: string,
        params?: { status?: string; limit?: number; offset?: number; batchSize?: number; orderIds?: string[]; orders?: any[] }
    ): Promise<any> {
        const marketplace = await this.registryService.findOne(marketplaceId);
        if (!marketplace) throw new BadRequestException(`Marketplace ID ${marketplaceId} não encontrado`);

        if (params?.orders && Array.isArray(params.orders) && params.orders.length > 0) {
            return this.processOrdersSync(params.orders, marketplace, params.batchSize);
        }

        const adapter = this.adapterRegistry.getOrderAdapter(marketplace.name);
        let orders: StandardOrder[] = [];

        if (params?.orderIds && params.orderIds.length > 0) {
            for (const orderId of params.orderIds) {
                try {
                    const detail = await adapter.getOrderDetails(orderId);
                    if (detail) orders.push(detail);
                } catch (e) {
                    this.logger.error(`Failed to fetch ${marketplace.name} order detail for ${orderId}: ${e.message}`);
                }
            }
        } else {
            orders = await adapter.getOrders({
                status: params?.status,
                limit: params?.limit,
                offset: params?.offset
            });
        }

        return this.processOrdersSync(orders, marketplace, params?.batchSize);
    }

    hasOrderAdapter(marketplaceName: string): boolean {
        return this.adapterRegistry.hasOrderAdapter(marketplaceName);
    }

    private async processOrdersSync(orders: any[], marketplace: any, batchSizeParam?: number) {
        const results: any[] = [];
        let movementsCreated = 0;
        const mId = marketplace._id;

        const flatItems: Array<{ orderId: string; externalId: string; qty: number }> = [];
        for (const order of orders) {
            const orderId = String(order.id || '');
            // Order-level check for skipping already processed orders
            const alreadySynced = await this.productService.existsMovementReference(orderId);
            if (alreadySynced) {
                results.push({ orderId, status: 'skipped', reason: 'already_synced' });
                continue;
            }

            const items = order.items || [];
            for (const item of items) {
                let externalId = item.id;
                if (!externalId && item.item?.id) externalId = item.item.id;

                const qty = Number(item.quantity || 0);
                if (externalId && qty) flatItems.push({ orderId, externalId, qty });
            }
        }

        if (flatItems.length === 0) return { marketplace: marketplace.name, ordersCount: orders.length, movementsCreated: 0, results };

        const externalIds = [...new Set(flatItems.map(i => i.externalId))];

        // [REF] Fetch Listings directly
        const listings = await this.listingService.listingModel.find({
            externalId: { $in: externalIds },
            marketplaceId: mId
        }).lean().exec();

        // Map listings by externalId for item enrichment
        const ptMap = new Map<string, any>();
        for (const l of listings) {
            if (l.productId) {
                ptMap.set(l.externalId, { ...l, productSku: String(l.productId) });
            }
        }

        for (const item of flatItems) {
            const pt = ptMap.get(item.externalId);
            if (!pt) {
                results.push({ orderId: item.orderId, externalId: item.externalId, status: 'failed', reason: 'product_not_mapped' });
                continue;
            }

            try {
                // Individual item creation with built-in compound index for safety
                await this.productService.createMovement(pt.productSku, {
                    type: 'outbound',
                    quantity: item.qty,
                    reference: item.orderId,
                    reason: `Venda ${marketplace.name}`,
                    status: 'completed'
                });
                movementsCreated++;
                results.push({ orderId: item.orderId, externalId: item.externalId, productId: pt.productSku, status: 'created', quantity: item.qty });
            } catch (error) {
                if (error.code === 11000) { // MongoDB duplicate key error
                    results.push({ orderId: item.orderId, externalId: item.externalId, status: 'skipped', reason: 'duplicate_detected' });
                } else {
                    this.logger.error(`Failed to sync item ${item.externalId} for order ${item.orderId}: ${error.message}`);
                    results.push({ orderId: item.orderId, externalId: item.externalId, status: 'failed', reason: error.message });
                }
            }
        }

        const batchSize = Math.max(1, Number(batchSizeParam ?? 20));
        return { marketplace: marketplace.name, ordersCount: orders.length, movementsCreated, batchSize, results };
    }

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
            id: String(raw.id || raw._id || raw.externalId),
            marketplaceId: String(raw.marketplaceId),
            date_created: new Date(dateCreated).toISOString(),
            total_amount: Number(totalAmount),
            buyer: normalizedBuyer,
            status: raw.status || 'unknown'
        };
    }
    /** Local order lookup for hybrid search (direct model query, no order module dependency). */
    private async findLocalOrders(search: string): Promise<OrderDocument[]> {
        const regex = new RegExp(search, 'i');
        return this.orderModel.find({
            $or: [
                { externalId: regex },
                { 'customer.name': regex },
                { 'customer.email': regex },
                { 'items.title': regex },
            ],
        }).sort({ createdAt: -1 }).limit(50).exec();
    }
}

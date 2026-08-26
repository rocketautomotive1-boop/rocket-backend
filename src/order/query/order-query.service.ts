import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { ProductRepository } from '../../product/product.repository';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../stock/ports/stock-query.port';
import { Result } from '../../common/utils/result.util';

/**
 * Read side of the order module: lookups + list + logistics-status enrichment.
 * Absorbs the former OrderOrchestrator.findOrder. No writes, no cross-domain cycles.
 */
@Injectable()
export class OrderQueryService {
    private readonly logger = new Logger(OrderQueryService.name);

    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly productRepository: ProductRepository,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
        @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    ) { }

    /** Find by Mongo _id or external id. */
    async getOrder(id: string | number): Promise<Result<OrderDocument>> {
        let order: OrderDocument | null = null;

        if (typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/)) {
            order = await this.orderRepository.findById(id);
        }
        if (!order && typeof id === 'string') {
            order = await this.orderRepository.findByExternalId(id);
        }
        if (!order) {
            return Result.fail(`Order ${id} not found in local database`);
        }

        await this.enrichLogisticsStatus([order]);
        return Result.ok(order);
    }

    async getOrderByExternalId(externalId: string): Promise<Result<OrderDocument>> {
        const order = await this.orderRepository.findByExternalId(externalId);
        if (!order) return Result.fail(`Order with external ID ${externalId} not found`);
        await this.enrichLogisticsStatus([order]);
        return Result.ok(order);
    }

    async findAll(
        offset = 0,
        limit = 50,
        search?: string,
        accountIds?: string[],
        marketplaceId?: string,
        status?: string,
    ): Promise<OrderDocument[]> {
        const orders = await this.orderRepository.findAll(offset, limit, search, accountIds, marketplaceId, status);
        return this.enrichLogisticsStatus(orders);
    }

    private async enrichLogisticsStatus(orders: OrderDocument[]): Promise<OrderDocument[]> {
        if (!orders.length) return orders;

        const DEFINITIVE_STATUSES = new Set(['deducted', 'unresolved', 'error', 'skipped', 'cancelled']);
        const pendingOrders = orders.filter(o => !o.logisticsStatus || !DEFINITIVE_STATUSES.has(o.logisticsStatus));

        if (pendingOrders.length > 0) {
            const externalIds = pendingOrders.map(o => (o.externalId || '').trim()).filter(id => !!id);
            if (externalIds.length > 0) {
                const movements = await this.stockQuery.findExistingReferences(externalIds);
                const movementSet = new Set(movements);
                for (const order of pendingOrders) {
                    const extId = (order.externalId || '').trim();
                    if (movementSet.has(extId)) {
                        order.logisticsStatus = 'deducted';
                    }
                }
            }
        }

        for (const order of orders) {
            if (!order.logisticsStatus) {
                order.logisticsStatus = 'pending';
            }
        }
        return orders;
    }
}

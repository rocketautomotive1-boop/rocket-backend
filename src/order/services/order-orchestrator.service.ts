import { Injectable, Logger } from '@nestjs/common';
import { OrderRepository } from '../order.repository';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { MarketplaceRegistryService } from '../../marketplace/services/marketplace-registry.service';
import { OrderDocument } from '../schemas/order.schema';
import { Result } from '../../common/utils/result.util';

@Injectable()
export class OrderOrchestrator {
    private readonly logger = new Logger(OrderOrchestrator.name);

    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly marketplaceOrderService: MarketplaceOrderService,
        private readonly marketplaceRegistry: MarketplaceRegistryService,
    ) { }

    /**
     * Finds an order by any available ID (Internal MongoDB ID, External Marketplace ID, or Legacy ID)
     */
    async findOrder(id: string | number): Promise<Result<OrderDocument>> {
        let order: OrderDocument | null = null;

        // 1. Try finding by MongoDB ObjectId
        if (typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/)) {
            order = await this.orderRepository.findById(id);
        }

        // 2. Try finding by Legacy Numeric ID - REMOVED (Legacy ID lookup deprecated)
        /*
        if (!order) {
            const numericId = typeof id === 'number' ? id : parseInt(id as string);
            if (!isNaN(numericId)) {
                // order = await this.orderRepository.findByLegacyId(numericId);
            }
        }
        */

        // 3. Try finding by External ID
        if (!order && typeof id === 'string') {
            order = await this.orderRepository.findByExternalId(id);
        }

        if (!order) {
            return Result.fail(`Order ${id} not found in local database`);
        }

        return Result.ok(order);
    }

    /**
     * Finds or synchronizes an order from a marketplace
     */
    async getFullOrder(externalId: string, marketplaceId?: string): Promise<Result<OrderDocument>> {
        // 1. Try to find locally first
        let order = await this.orderRepository.findByExternalId(externalId, marketplaceId);

        if (order) {
            return Result.ok(order);
        }

        // 2. If not found and marketplaceId is missing, try to detect it
        if (!marketplaceId) {
            const detectedMarketplaceId = await this.marketplaceRegistry.detectMarketplaceByOrderId(externalId);
            if (detectedMarketplaceId) {
                marketplaceId = String(detectedMarketplaceId._id);


            }
        }

        if (!marketplaceId) {
            return Result.fail(`Could not detect marketplace for order ${externalId}`);
        }

        // 3. Fetch from adapter (Note: Sync logic is currently in OrderService, 
        // but in the future it could be moved here or orchestrated better)
        return Result.fail(`Order ${externalId} not found locally. Please sync it first.`);
    }
}

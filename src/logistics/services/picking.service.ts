import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductModel, ProductDocument } from '../../product/product-types';

@Injectable()
export class PickingService {
    private readonly logger = new Logger(PickingService.name);

    constructor(
        private readonly marketplaceService: MarketplaceService,
        private readonly marketplaceOrderService: MarketplaceOrderService,
        @InjectModel(ProductModel.name)
        private readonly productModel: Model<ProductDocument>,
    ) { }

    async getPickingList(orderId: string, marketplaceId: string) {
        this.logger.log(`Generating picking list for Order ${orderId} (Marketplace ${marketplaceId})`);

        // 1. Fetch Order Details from Marketplace (Source of Truth)
        let order;
        try {
            order = await this.marketplaceOrderService.getOrderDetails(orderId, marketplaceId);
        } catch (error) {
            this.logger.error(`Failed to fetch order details: ${error.message}`);
            throw new NotFoundException(`Order ${orderId} not found in marketplace`);
        }

        if (!order || !order.items) {
            throw new NotFoundException('Order items not found');
        }

        const pickingList = [];

        // 2. Process each item
        for (const item of order.items) {
            const sku = item.item?.sku || item.sku || item.seller_sku || ''; // Normalize SKU access
            const title = item.item?.title || item.title || 'Unknown Product';
            const qtyNeeded = item.quantity || 1;

            const pickingItem = {
                sku,
                title,
                qty_needed: qtyNeeded,
                locations: [],
                status: 'pending' // pending, partial, ready
            };

            if (sku) {
                // 3. Find Internal Product (Mongoose)
                const product = await this.productModel.findOne({ partNumber: sku }).lean();

                if (product) {
                    // 4. Find Locations (Allocations are embedded in products in Mongo version)
                    pickingItem.locations = (product.allocations || []).map((alloc: any) => ({
                        box_code: alloc.boxCode,
                        allocation_code: alloc.code || 'Unallocated',
                        warehouse: alloc.warehouseId?.toString() || 'Unknown',
                        qty_in_box: alloc.quantity,
                        path: `R:${alloc.row} S:${alloc.shelf} L:${alloc.level}`
                    }));
                }
            }

            pickingList.push(pickingItem);
        }

        return {
            orderId: order.id,
            buyer: order.buyer?.name,
            items: pickingList
        };
    }
}

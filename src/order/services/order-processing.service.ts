import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { ProductService } from '../../product/product.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { Result } from '../../common/utils/result.util';

@Injectable()
export class OrderProcessingService {
    private readonly logger = new Logger(OrderProcessingService.name);

    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly productService: ProductService,
        private readonly marketplaceOrderService: MarketplaceOrderService,
    ) { }

    async getSeparationList(order: OrderDocument): Promise<any> {
        const separationItems = [];

        for (const item of order.items) {
            if (!item.productId) {
                separationItems.push({
                    sku: 'N/A', // SKU removed from snapshot
                    title: item.title,
                    quantity: item.quantity,
                    locations: []
                });
                continue;
            }

            // Validating Product ID to prevent crash if lazy sync saved an external ID
            if (!String(item.productId).match(/^[0-9a-fA-F]{24}$/)) {
                separationItems.push({
                    sku: 'INVALID_ID',
                    title: item.title,
                    quantity: item.quantity,
                    locations: [] // Cannot fetch inventory for invalid ID
                });
                continue;
            }

            const inventory = await this.productService.getInventory(String(item.productId));

            const locations = inventory.boxItems?.map(bi => ({
                boxId: bi.boxId,
                boxName: bi.box?.code || `Box #${bi.boxId}`,
                warehouse: bi.box?.warehouse?.name || 'Armazém Geral',
                quantityInBox: bi.quantity,
                condition: bi.condition?.name || 'Novo'
            })) || [];

            // Fetch product to get internal SKU
            let internalSku = 'N/A';
            if (item.productId) {
                const product = await this.productService.findOne(String(item.productId));
                internalSku = String(product?.partNumber || product?.sku || 'N/A');
                console.log(`[getSeparationList] Product ID: ${item.productId}, Product partNumber: ${product?.partNumber}, Product sku: ${product?.sku}, Internal SKU chosen: ${internalSku}`);
            }

            separationItems.push({
                sku: internalSku,  // Use internal product SKU
                externalId: item.externalId, // Expose externalId
                title: item.title,
                quantity: item.quantity,
                productId: item.productId,
                locations: locations
            });
        }

        return separationItems;
    }

    async validatePicking(order: OrderDocument, scannedCode: string): Promise<Result<any>> {
        // 1. Check if item exists in order (by Title only, as SKU is removed from snapshot)
        const itemByTitle = order.items.find(i => i.title === scannedCode);

        if (itemByTitle) {
            // Can't return SKU easily without fetching product, but title matched so it's valid
            return Result.ok({
                valid: true,
                item: {
                    sku: 'N/A', // SKU unknown without lookup
                    title: itemByTitle.title,
                    quantity: itemByTitle.quantity
                }
            });
        }

        // 2. Main Check: Check via Product Service by External Code (SKU/EAN)
        // This is now the primary way since DB items don't store SKU
        try {
            const product = await this.productService.findBySku(scannedCode);
            // Or findByBarcode if available
            // const product = await this.productService.findByBarcode(scannedCode); 

            if (product) {
                const match = order.items.find(i => String(i.productId) === String(product._id));
                if (match) {
                    return Result.ok({
                        valid: true,
                        item: {
                            sku: String(product.sku || product.partNumber),
                            title: match.title,
                            quantity: match.quantity
                        }
                    });
                }
            }
        } catch (e) {
            this.logger.warn(`Error resolving scanned code ${scannedCode}: ${e}`);
        }

        return Result.fail(`Item ${scannedCode} não pertence a este pedido.`);
    }

    async enrichBillingData(order: OrderDocument): Promise<Result<OrderDocument>> {
        try {
            // 1. Fetch fresh details from Marketplace Adapter (to get billing.id)
            const details = await this.marketplaceOrderService.getOrderDetails(order.externalId, order.marketplaceId as any);

            // Correct path: details.buyer.billing_info (Standard ML) or details.billing_info (Fallback)
            const billingInfoRef = details.buyer?.billing_info || details.billing_info;

            if (!billingInfoRef || !billingInfoRef.id) {
                this.logger.warn(`Billing Info ID not found for order ${order.externalId}. details.buyer: ${JSON.stringify(details.buyer)}`);
                return Result.fail(`Billing info ID not found for order ${order.externalId}`);
            }

            const bId = billingInfoRef.id;

            // 2. Fetch full billing info JSON
            const billingJson = await this.marketplaceOrderService.getBillingInfo(String(bId), order.marketplaceId as any);

            if (billingJson && billingJson.buyer && billingJson.buyer.billing_info) {
                const info = billingJson.buyer.billing_info;

                // 3. Update Order Document
                order.customer.name = `${info.name} ${info.last_name}`.trim();
                order.customer.document = (info.identification?.number || order.customer.document) as string;

                if (info.address) {
                    order.customer.address = {
                        street: info.address.street_name,
                        number: info.address.street_number,
                        zipCode: info.address.zip_code,
                        city: info.address.city_name,
                        state: info.address.state?.code || info.address.state?.name,
                        neighborhood: ''
                    };
                }

                await this.orderRepository.save(order);
            }

            return Result.ok(order);
        } catch (error) {
            this.logger.error(`Error enriching billing data for order ${order.externalId}: ${error.message}`);
            return Result.fail(`Error enriching billing data: ${error.message}`);
        }
    }
}

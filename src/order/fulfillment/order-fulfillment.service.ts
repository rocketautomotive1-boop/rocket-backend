import { Inject, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { Result } from '../../common/utils/result.util';
import { ProductService } from '../../product/product.service';
import { ProductRepository } from '../../product/product.repository';
import { PRODUCT_RESOLVER_PORT, ProductResolverPort } from '../ports/product-resolver.port';
import { MARKETPLACE_ORDER_GATEWAY, MarketplaceOrderGateway } from '../ports/marketplace-order.gateway';
import { ORDER_EVENTS, OrderSyncedEvent } from '../events/order.events';

/**
 * Fulfillment / logistics concerns of an order: separation list, picking validation,
 * picking completion (stock movements), manual logistics retry, and billing enrichment.
 * Reads product data via ProductService (no cycle: product no longer imports order) and
 * marketplace data via the gateway port.
 */
@Injectable()
export class OrderFulfillmentService {
    private readonly logger = new Logger(OrderFulfillmentService.name);

    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly productService: ProductService,
        private readonly productRepository: ProductRepository,
        @Inject(PRODUCT_RESOLVER_PORT) private readonly resolver: ProductResolverPort,
        @Inject(MARKETPLACE_ORDER_GATEWAY) private readonly gateway: MarketplaceOrderGateway,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    async getSeparationList(order: OrderDocument): Promise<any> {
        const separationItems = [];

        for (const item of order.items) {
            if (!item.productId) {
                separationItems.push({ sku: 'N/A', title: item.title, quantity: item.quantity, locations: [] });
                continue;
            }

            if (!String(item.productId).match(/^[0-9a-fA-F]{24}$/)) {
                separationItems.push({ sku: 'INVALID_ID', title: item.title, quantity: item.quantity, locations: [] });
                continue;
            }

            const inventory = await this.productService.getInventory(String(item.productId));
            const locations = inventory.boxItems?.map(bi => ({
                boxId: bi.boxId,
                boxName: bi.box?.code || `Box #${bi.boxId}`,
                warehouse: bi.box?.warehouse?.name || 'Armazém Geral',
                quantityInBox: bi.quantity,
                condition: bi.condition?.name || 'Novo',
            })) || [];

            let internalSku = 'N/A';
            const product = await this.productService.findOne(String(item.productId));
            internalSku = String(product?.partNumber || 'N/A');

            separationItems.push({
                sku: internalSku,
                externalId: item.externalId,
                title: item.title,
                quantity: item.quantity,
                productId: item.productId,
                locations,
            });
        }

        return separationItems;
    }

    async validatePicking(order: OrderDocument, scannedCode: string): Promise<Result<any>> {
        const itemByTitle = order.items.find(i => i.title === scannedCode);
        if (itemByTitle) {
            return Result.ok({ valid: true, item: { sku: 'N/A', title: itemByTitle.title, quantity: itemByTitle.quantity } });
        }

        try {
            const product = await this.productService.findByBarcode(scannedCode);
            if (product) {
                const match = order.items.find(i => String(i.productId) === String(product._id));
                if (match) {
                    return Result.ok({ valid: true, item: { sku: String(product.partNumber), title: match.title, quantity: match.quantity } });
                }
            }
        } catch (e) {
            this.logger.warn(`Error resolving scanned code ${scannedCode}: ${e}`);
        }

        return Result.fail(`Item ${scannedCode} não pertence a este pedido.`);
    }

    async enrichBillingData(order: OrderDocument): Promise<Result<OrderDocument>> {
        try {
            const details = await this.gateway.fetchOrder(order.externalId, order.marketplaceId.toString());
            const billingInfoRef = details?.buyer?.billing_info || details?.billing_info;

            if (!billingInfoRef || !billingInfoRef.id) {
                this.logger.warn(`Billing Info ID not found for order ${order.externalId}.`);
                return Result.fail(`Billing info ID not found for order ${order.externalId}`);
            }

            const billingJson = await this.gateway.getBillingInfo(String(billingInfoRef.id), order.marketplaceId.toString());

            if (billingJson?.buyer?.billing_info) {
                const info = billingJson.buyer.billing_info;
                order.customer.name = `${info.name} ${info.last_name}`.trim();
                order.customer.document = (info.identification?.number || order.customer.document) as string;
                if (info.address) {
                    order.customer.address = {
                        street: info.address.street_name,
                        number: info.address.street_number,
                        zipCode: info.address.zip_code,
                        city: info.address.city_name,
                        state: info.address.state?.code || info.address.state?.name,
                        neighborhood: '',
                    };
                }
                await this.orderRepository.save(order);
            }

            return Result.ok(order);
        } catch (error) {
            this.logger.error(`Error enriching billing data for order ${order.externalId}: ${(error as Error).message}`);
            return Result.fail(`Error enriching billing data: ${(error as Error).message}`);
        }
    }

    async completePicking(
        order: OrderDocument,
        pickedItems: Record<string, number>,
    ): Promise<Result<{ stockUpdated: string[]; published: string[]; skipped: string[] }>> {
        const stockUpdated: string[] = [];
        const published: string[] = [];
        const skipped: string[] = [];

        const movementReference = String(order.externalId || order._id);
        const existingMovement = await this.productRepository.existsMovementReference(movementReference);
        if (existingMovement) {
            this.logger.log(`Order ${order._id} picking already completed (reference: ${movementReference})`);
            return Result.ok({ stockUpdated: [], published: [], skipped: Object.keys(pickedItems) });
        }

        for (const [productIdKey, quantity] of Object.entries(pickedItems)) {
            try {
                const product = Types.ObjectId.isValid(productIdKey)
                    ? await this.productService.findOne(productIdKey)
                    : null;
                if (!product) {
                    this.logger.warn(`Product with ID ${productIdKey} not found`);
                    skipped.push(productIdKey);
                    continue;
                }

                const productId = product._id || (product as any).id;

                await this.productService.createMovement(String(productId), {
                    type: 'outbound',
                    quantity,
                    condition: 'new',
                    reason: 'Venda Marketplace',
                    reference: movementReference,
                    status: 'completed',
                } as any);

                stockUpdated.push(productIdKey);

                const newStock = await this.productRepository.calculateStock(productIdKey);
                this.eventEmitter.emit('product.stock.updated', {
                    productId,
                    partNumber: product.partNumber,
                    newStock,
                });

                published.push(productIdKey);
                this.logger.log(`Stock movement created for product ${productIdKey}: -${quantity} (ref: ${movementReference})`);
            } catch (err) {
                this.logger.error(`Error processing product ${productIdKey}:`, err as Error);
                skipped.push(productIdKey);
            }
        }

        order.status = 'ready_to_ship';
        order.logisticsStatus = 'deducted';
        order.history = order.history ?? [];
        order.history.push({
            status: 'ready_to_ship',
            at: new Date(),
            trigger: 'picking_complete',
            details: { pickedItems, stockUpdated, published, skipped },
        });
        await this.orderRepository.save(order);

        return Result.ok({ stockUpdated, published, skipped });
    }

    async retryLogistics(order: OrderDocument, userId: string): Promise<Result<void>> {
        if (order.logisticsStatus === 'deducted') {
            return Result.fail('Logística já processada para este pedido.');
        }

        this.logger.log(`Retrying logistics for order ${order.externalId} (User: ${userId})`);

        const eventItems = [];
        let missingProducts = 0;

        for (const item of order.items) {
            const hasInternalLink = item.productId && Types.ObjectId.isValid(item.productId);
            if (!hasInternalLink) {
                const pId = await this.resolver.resolveProduct(
                    item.externalId || '',
                    (item as any).sku || '',
                    order.marketplaceId ? String(order.marketplaceId) : undefined,
                    item.title,
                );
                if (pId) {
                    item.productId = new Types.ObjectId(pId);
                } else {
                    missingProducts++;
                }
            }
            eventItems.push({
                sku: (item as any).sku || 'N/A',
                productId: item.productId ? item.productId.toString() : null,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
            });
        }

        if (missingProducts > 0) {
            this.logger.warn(`Order ${order.externalId} has ${missingProducts} items without internal product link.`);
        }

        await this.orderRepository.save(order);

        const emitted = this.eventEmitter.emit(
            ORDER_EVENTS.SYNCED,
            new OrderSyncedEvent(
                order.id,
                order.externalId,
                order.marketplaceId as any,
                eventItems,
                'Manual Retry',
            ),
        );

        if (emitted) {
            order.logisticsStatus = 'deducted';
            order.history = order.history ?? [];
            order.history.push({
                status: order.status,
                at: new Date(),
                trigger: 'logistics_retry',
                details: { user: userId },
            });
            await this.orderRepository.save(order);
            return Result.ok();
        }
        return Result.fail('Falha ao emitir evento de estoque.');
    }
}

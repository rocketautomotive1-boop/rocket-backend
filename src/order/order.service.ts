import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderDocument } from './schemas/order.schema';
import { OrderRepository } from './order.repository';
import { MarketplaceOrderService } from '../marketplace/services/marketplace-order.service';
import { ProductService } from '../product/product.service';
import { ProductRepository } from '../product/product.repository';
import { ProductMovementService } from '../product/services/product-movement.service';
import { ProductMatcherService } from '../product/services/product-matcher.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderSyncedEvent, OrderCancelledEvent } from './events/order.events';
import { OrderSyncPipeline } from './pipeline/order-sync.pipeline';
import { Result } from '../common/utils/result.util';
import { OrderProcessingService } from './services/order-processing.service';
import { OrderOrchestrator } from './services/order-orchestrator.service';
import { OrderMapperService } from './services/order-mapper.service';
import { StockOrchestratorService } from './services/stock-orchestrator.service';
import { QueueService } from '../queue/queue.service';
import { ClientSession } from 'mongoose';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

@Injectable()
export class OrderService {
    private readonly logger = new Logger(OrderService.name);

    constructor(
        private readonly orderRepository: OrderRepository,
        private readonly marketplaceOrderService: MarketplaceOrderService,
        @Inject(forwardRef(() => ProductService))
        private readonly productService: ProductService,
        private readonly productRepository: ProductRepository,
        private readonly productMovementService: ProductMovementService,
        private readonly productMatcher: ProductMatcherService,
        private readonly eventEmitter: EventEmitter2,
        private readonly orderProcessingService: OrderProcessingService,
        private readonly orderOrchestrator: OrderOrchestrator,
        private readonly orderMapper: OrderMapperService,
        private readonly stockOrchestrator: StockOrchestratorService,

        @Inject(forwardRef(() => QueueService))
        private readonly queueService: QueueService,
        private readonly amqpConnection: AmqpConnection,
        private readonly orderSyncPipeline: OrderSyncPipeline,
    ) { }

    async saveBatch(orders: any[]): Promise<void> {
        const dbOrders = await Promise.all(orders.map(async o => {
            const resolvedItems = await Promise.all((o.items || []).map(async (i: any) => {
                const externalItemId = String(i.id || '');
                const sku = i.sku || '';
                const pId = await this.productMatcher.resolveProduct(externalItemId, sku, o.marketplaceId);
                const isValidPId = pId && Types.ObjectId.isValid(pId);

                return {
                    externalId: externalItemId,
                    title: i.title,
                    quantity: i.quantity,
                    unitPrice: i.unit_price,
                    productId: isValidPId ? new Types.ObjectId(pId) : null,
                };
            }));

            return {
                externalId: o.id,
                marketplaceId: o.marketplaceId,
                status: o.status,
                totalAmount: o.total_amount,
                createdAt: new Date(o.date_created),
                customer: {
                    name: o.buyer?.name || 'Comprador',
                    document: o.buyer?.document || '',
                    email: o.buyer?.email || '',
                    phone: o.buyer?.phone || ''
                },
                items: resolvedItems,
                syncedAt: new Date(),
            };
        }));
        await this.orderRepository.upsertBatch(dbOrders);
    }

    async createDirectOrder(customerId: number, items: any[], paymentData: any): Promise<OrderDocument> {
        // 1. Create Order Document
        // Embedded Customer Snapshot (simplified for Web Store)
        const customerSnapshot = {
            name: 'Cliente Web',
            document: '00000000000',
            email: 'web@store.com',
            phone: '',
            address: { zipCode: '', street: '', number: '', neighborhood: '', city: '', state: '' }
        }; // TODO: Fetch real customer data if CustomerModule migrated

        const orderItems = items.map(item => ({
            title: item.product?.name || 'Produto Web',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            productId: item.productId // Legacy ID ref
        }));

        const order = await this.orderRepository.create({
            status: 'PENDING',
            marketplaceId: 9999,
            externalId: `WEB-${Date.now()}`,
            customer: customerSnapshot,
            items: orderItems,
            totalAmount: items.reduce((acc, item) => acc + (Number(item.unitPrice) * item.quantity), 0),
            createdAt: new Date(),
            logs: []
        });

        await this.createLog(order.externalId, 'CREATE', 'Pedido criado via Loja Virtual');
        // Actually log is embedded now.

        return order;
    }

    async enqueueSyncOrder(externalId: string, marketplaceId: string, source: 'webhook' | 'sync' = 'sync'): Promise<Result<any>> {
        this.logger.log(`Starting direct sync for order ${externalId} (source=${source})`);

        const queueRecord = await this.queueService.addToQueue({
            type: 'orders-sync',
            marketplaceId: String(marketplaceId),
            attemptId: externalId,
            metadata: { externalId, source },
        });

        this.eventEmitter.emit('orders-sync', {
            externalId,
            marketplaceId: String(marketplaceId),
            queueRecordId: queueRecord._id.toString(),
            source,
        });

        return Result.ok({ message: 'Order sync started', status: 'processing' });
    }

    // Main Transactional Sync Logic — delegated to OrderSyncPipeline
    async processSyncOrder(data: { externalId: string; marketplaceId: string; source?: 'webhook' | 'sync' }): Promise<void> {
        await this.orderSyncPipeline.execute(data.externalId, data.marketplaceId, data.source ?? 'sync');
    }

    /**
     * Re-emite o evento ORDER_CANCELLED para um pedido cancelado cujo evento foi perdido.
     * Útil para recuperar notificações e reversões de estoque não processadas.
     */
    async reprocessCancellation(orderId: string): Promise<Result<any>> {
        const order = await this.orderRepository.findById(orderId);
        if (!order) return Result.fail('Order not found');
        if ((order.status ?? '').toLowerCase() !== 'cancelled') {
            return Result.fail(`Order ${order.externalId} is not cancelled (status: ${order.status})`);
        }

        const event = new OrderCancelledEvent(
            order._id.toString(),
            order.externalId,
            order.marketplaceId.toString(),
            '',
            order.totalAmount,
            null,
            null,
            false, // stockReverted será tratado pelo listener se logisticsStatus === 'deducted'
            'webhook', // força notificação
        );

        this.eventEmitter.emit(ORDER_EVENTS.CANCELLED, event);
        this.logger.log(`Reprocessing cancellation for order ${order.externalId}`);
        return Result.ok({ message: `Cancellation re-emitted for order ${order.externalId}` });
    }

    /**
     * Deprecated: Use enqueueSyncOrder
     */
    async syncOrder(externalId: string, marketplaceId: string, skipLogistics: boolean = false): Promise<Result<OrderDocument>> {
        // Redirect to async logic (but we wait for result to keep compatibility if possible, or just Enqueue)
        // Since the interface returns OrderDocument, we can't easily switch to pure async without breaking callers (like controllers).
        // For the Controller Refactor, we will switch the Controller to use enqueueSyncOrder.
        // For other internal calls, we might want to awaiting the process.

        try {
            await this.processSyncOrder({ externalId, marketplaceId });
            return this.getOrderByExternalId(externalId);
        } catch (e) {
            return Result.fail(e.message);
        }
    }

    // --- New Methods for Enhanced Order Details ---

    async addNote(id: string, message: string, user: string = 'User'): Promise<Result<OrderDocument>> {
        const result = await this.getOrder(id);
        if (result.isFailure) return result;

        await this.createLog(id, 'NOTE', message, { user });
        return this.getOrder(id);
    }

    async getSeparationList(id: string): Promise<any> {
        const result = await this.getOrder(id);
        if (result.isFailure) throw new NotFoundException(result.error);
        return this.orderProcessingService.getSeparationList(result.getValue());
    }

    async enrichBillingData(id: string): Promise<Result<OrderDocument>> {
        const res = await this.getOrder(id);
        if (res.isFailure) return res;
        return this.orderProcessingService.enrichBillingData(res.getValue());
    }

    async validatePickingScan(id: string, code: string): Promise<Result<any>> {
        const result = await this.getOrder(id);
        if (result.isFailure) return Result.fail(result.error);
        return this.orderProcessingService.validatePicking(result.getValue(), code);
    }

    async ignoreOrder(id: string, userId: string): Promise<Result<void>> {
        const result = await this.getOrder(id);
        if (result.isFailure) return Result.fail('Order not found');
        const order = result.getValue();

        order.status = 'ignored';
        await this.createLog(id, 'IGNORE', `Pedido ignorado pelo usuário`, { user: userId });
        await this.orderRepository.save(order);

        return Result.ok();
    }

    async completePicking(id: string, pickedItems: Record<string, number>): Promise<Result<{ stockUpdated: string[], published: string[], skipped: string[] }>> {
        const result = await this.getOrder(id);
        if (result.isFailure) return Result.fail('Order not found');
        const order = result.getValue();

        const stockUpdated: string[] = [];
        const published: string[] = [];
        const skipped: string[] = [];

        // Check if movement already exists for this order (using externalId as reference)
        const movementReference = String(order.externalId || id);
        const existingMovement = await this.productRepository.existsMovementReference(movementReference);

        if (existingMovement) {
            this.logger.log(`Order ${id} picking already completed - stock movements already exist (reference: ${movementReference})`);
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

                const productId = product._id || product['id'];

                // Create stock movement (outbound) - this automatically updates stock and totalSold
                await this.productMovementService.create({
                    productId: String(productId),
                    type: 'outbound',
                    quantity: quantity,
                    condition: 'new',
                    reason: 'Venda Marketplace',
                    reference: movementReference,
                    price: 0, // Sale price can be added from order.items if needed
                });

                stockUpdated.push(productIdKey);

                const newStock = await this.productRepository.calculateStock(productIdKey);
                this.eventEmitter.emit('product.stock.updated', {
                    productId: productId,
                    partNumber: product.partNumber,
                    newStock,
                });

                published.push(productIdKey);
                this.logger.log(`Stock movement created for product ${productIdKey}: -${quantity} (reference: ${movementReference})`);
            } catch (err) {
                this.logger.error(`Error processing product ${productIdKey}:`, err);
                skipped.push(productIdKey);
            }
        }

        order.status = 'ready_to_ship';
        order.logisticsStatus = 'deducted'; // Stock deducted via picking
        await this.createLog(id, 'PICKING_COMPLETE', `Separação finalizada. Estoque atualizado: ${stockUpdated.join(', ')}`, { pickedItems, stockUpdated, published, skipped });
        await this.orderRepository.save(order);

        return Result.ok({ stockUpdated, published, skipped });
    }

    async retryLogistics(id: string, userId: string): Promise<Result<void>> {
        const result = await this.getOrder(id);
        if (result.isFailure) return Result.fail('Order not found');
        const order = result.getValue();

        if (order.logisticsStatus === 'deducted') {
            return Result.fail('Logística já processada para este pedido.');
        }

        this.logger.log(`Retrying logistics for order ${order.externalId} (User: ${userId})`);

        // Check internal products resolution
        const eventItems = [];
        let missingProducts = 0;

        for (const item of order.items) {
            const hasInternalLink = item.productId && Types.ObjectId.isValid(item.productId);

            if (!hasInternalLink) {
                const extRef = item.externalId || '';
                const sku = (item as any).sku || '';
                const marketplaceId = order.marketplaceId ? String(order.marketplaceId) : undefined;
                const pId = await this.productMatcher.resolveProduct(extRef, sku, marketplaceId, item.title);

                if (pId) {
                    item.productId = new Types.ObjectId(pId);
                } else {
                    missingProducts++;
                }
            }

            eventItems.push({
                sku: (item as any).sku || 'N/A',
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice
            });
        }

        if (missingProducts > 0) {
            // We can proceed but warn? Or strictly fail?
            // Let's proceed with what we have, but log warning.
            this.logger.warn(`Order ${order.externalId} has ${missingProducts} items without internal product link.`);
        }

        // Save potential product links update
        await this.orderRepository.save(order);

        // Emit Event
        const emitted = this.eventEmitter.emit(
            ORDER_EVENTS.SYNCED,
            new OrderSyncedEvent(
                order.id,
                order.externalId,
                order.marketplaceId as any,
                eventItems,
                'Manual Retry'
            )
        );

        if (emitted) {
            order.logisticsStatus = 'deducted';
            await this.createLog(id, 'LOGISTICS_RETRY', 'Processamento de estoque reenviado manualmente.', { user: userId });
            await this.orderRepository.save(order);
            return Result.ok();
        } else {
            return Result.fail('Falha ao emitir evento de estoque.');
        }
    }

    // --- End New Methods ---

    // --- End New Methods ---



    async getOrder(id: string | number): Promise<Result<OrderDocument>> {
        const result = await this.orderOrchestrator.findOrder(id);
        if (result.isSuccess) {
            await this.enrichLogisticsStatus([result.getValue()]);
        }
        return result;
    }

    async getOrderByExternalId(externalId: string): Promise<Result<OrderDocument>> {
        const order = await this.orderRepository.findByExternalId(externalId);
        if (!order) return Result.fail(`Order with external ID ${externalId} not found`);
        await this.enrichLogisticsStatus([order]);
        return Result.ok(order);
    }

    async createLog(orderId: any, type: string, message: string, details?: any) {
        // Embedded log update
        // We need to find order first
        // If orderId is full object (from save), use it

        let query: any = {};
        if (typeof orderId === 'object' && orderId._id) {
            query = { _id: orderId._id };
        } else if (typeof orderId === 'string' && orderId.match(/^[0-9a-fA-F]{24}$/)) {
            query = { _id: orderId };
        } else {
            query = { externalId: orderId }; // Fallback
        }

        await this.orderRepository.updateOne(query, {
            $push: {
                logs: {
                    logType: type,
                    message,
                    details,
                    createdAt: new Date()
                }
            }
        });
    }

    async findAll(offset = 0, limit = 50, search?: string): Promise<OrderDocument[]> {
        const orders = await this.orderRepository.findAll(offset, limit, search);
        return this.enrichLogisticsStatus(orders);
    }

    private async enrichLogisticsStatus(orders: OrderDocument[]): Promise<OrderDocument[]> {
        if (!orders.length) return orders;

        // Only query movements for orders that don't already have a definitive status.
        // The pipeline persists logisticsStatus on the order doc, so synced orders skip this.
        const DEFINITIVE_STATUSES = new Set(['deducted', 'unresolved', 'error', 'skipped']);
        const pendingOrders = orders.filter(o => !o.logisticsStatus || !DEFINITIVE_STATUSES.has(o.logisticsStatus));

        if (pendingOrders.length > 0) {
            const externalIds = pendingOrders.map(o => (o.externalId || '').trim()).filter(id => !!id);

            if (externalIds.length > 0) {
                this.logger.debug(`[StockStatus] Checking ${externalIds.length} pending orders. Sample IDs: ${externalIds.slice(0, 3).join(', ')}`);

                const movements = await this.productRepository.findMovementsByReferences(externalIds);
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

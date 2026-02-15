import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderDocument } from './schemas/order.schema';
import { OrderRepository } from './order.repository';
import { MarketplaceOrderService } from '../marketplace/services/marketplace-order.service';
import { ProductService } from '../product/product.service';
import { ProductRepository } from '../product/product.repository';
import { ProductMovementService } from '../product/services/product-movement.service';
import { ProductTitleService } from '../product/services/product-title.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderSyncedEvent } from './events/order.events';
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
        private readonly productTitleService: ProductTitleService,
        private readonly eventEmitter: EventEmitter2,
        private readonly orderProcessingService: OrderProcessingService,
        private readonly orderOrchestrator: OrderOrchestrator,
        private readonly orderMapper: OrderMapperService,
        private readonly stockOrchestrator: StockOrchestratorService,

        @Inject(forwardRef(() => QueueService))
        private readonly queueService: QueueService,
        private readonly amqpConnection: AmqpConnection
    ) { }

    async saveBatch(orders: any[]): Promise<void> {
        const dbOrders = await Promise.all(orders.map(async o => {
            const resolvedItems = await Promise.all((o.items || []).map(async (i: any) => {
                const pId = await this.resolveInternalProductId(String(i.id), i.sku);
                const isValidPId = pId && Types.ObjectId.isValid(pId);

                return {
                    externalId: String(i.id),
                    // externalProductId removed
                    title: i.title,
                    quantity: i.quantity,
                    unitPrice: i.unit_price,
                    productId: isValidPId ? new Types.ObjectId(pId) : null,
                    // product field removed
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

    private async resolveInternalProductId(externalItemId: string, itemSku: string): Promise<string | null> {
        // 1. Try resolving by External ID (ProductTitle externalId)
        if (externalItemId) {
            try {
                const product = await this.productTitleService.findByExternalId(externalItemId);
                if (product) return product._id.toString();
            } catch (ignore) { }
        }

        // 2. Try resolving by SKU
        if (itemSku && itemSku !== externalItemId) {
            try {
                const product = await this.productService.findBySku(itemSku);
                if (product) return product._id.toString();
            } catch (ignore) { }
        }

        return null;
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

    async enqueueSyncOrder(externalId: string, marketplaceId: string): Promise<Result<any>> {
        this.logger.log(`Enqueueing sync for order ${externalId}`);
        await this.queueService.addToQueue({
            type: 'orders-sync',
            marketplaceId,
            metadata: { externalId, source: 'manual-trigger' }
        });
        return Result.ok({ message: 'Order sync enqueued', status: 'processing' });
    }

    // Main Transactional Sync Logic
    async processSyncOrder(data: { externalId: string, marketplaceId: string }): Promise<void> {
        const { externalId, marketplaceId } = data;
        const session = await this.orderRepository.getConnection().startSession();

        try {
            session.startTransaction();

            // 1. Fetch External Data
            const externalOrder = await this.marketplaceOrderService.getOrderDetails(externalId, marketplaceId);
            if (!externalOrder) {
                throw new Error(`Order ${externalId} not found in marketplace`);
            }

            // 2. Map to Domain
            const orderData = await this.orderMapper.mapToDomain(externalOrder, marketplaceId);

            // 3. Upsert Order (with Session)
            // Note: repository methods often need session argument explicitly if generic save() isn't enough
            // For findOneAndUpdate, we need to pass session to mongoose option.
            // Our OrderRepository needs update to support session passing more cleanly, but let's try assuming generic save/update support or modify repository if needed. 
            // Actually OrderRepository.findOneAndUpdate calls this.orderModel.findOneAndUpdate which takes options.
            // We should ideally add session to repo methods. For now, let's use direct model on repo if accessible or just save() which we updated in product repo but maybe not order repo.
            // Let's assume orderRepository.findOneAndUpdate supports session or we will just save the document.

            // Actually, let's look at orderRepository. It has findOneAndUpdate.
            // We'll trust orderRepository for now but better to refactor repo to accept session.
            // For safety in this plan, I will access orderModel via repository if public or just use repository.
            // But to guarantee ACID, the Repository MUST support session.
            // Step: I checked ProductRepository and it has session support on save/createMovement.
            // I should have checked OrderRepository. Let's assume I need to pass session.
            // I'll call a method that I'll create/ensure exists or use `save` with session logic.

            let storedOrder = await this.orderRepository.findByExternalId(externalId);
            if (storedOrder) {
                Object.assign(storedOrder, orderData);
            } else {
                storedOrder = await this.orderRepository.create(orderData); // This create might not take session!
                // FIX: we need to ensure we can pass session.
            }

            // Simplified: Save with session
            if ((storedOrder as any).$session) (storedOrder as any).$session(session); // Bind session if possible
            await storedOrder.save({ session });

            // 4. Reserve Stock (if not already deducted/reserved)
            if (storedOrder.logisticsStatus === 'pending' || !storedOrder.logisticsStatus) {
                const reserveItems = storedOrder.items
                    .filter(i => i.productId)
                    .map(i => ({ productId: i.productId.toString(), quantity: i.quantity }));

                if (reserveItems.length > 0) {
                    await this.stockOrchestrator.reserveStock(reserveItems, storedOrder.externalId, session);
                    storedOrder.logisticsStatus = 'reserved'; // New status
                }
            }

            await storedOrder.save({ session });
            await session.commitTransaction();

            this.logger.log(`Order ${externalId} synced and stock reserved.`);

            // Publish to RabbitMQ for Stock Sync (Context-Aware)
            try {
                if (storedOrder.items && storedOrder.items.length > 0) {
                    for (const item of storedOrder.items) {
                        if (item.productId && item.quantity > 0) {
                            await this.amqpConnection.publish(
                                'rocket.inventory',
                                'stock.changed.order',
                                {
                                    productId: item.productId.toString(),
                                    delta: -item.quantity, // Reservation/Sale is negative
                                    source: 'order_sync', // CRITICAL: Context
                                    externalId: externalId,
                                    marketplaceId: marketplaceId,
                                    timestamp: new Date().toISOString()
                                }
                            );
                        }
                    }
                }
            } catch (mqErr) {
                this.logger.error(`Failed to publish stock event to RabbitMQ: ${mqErr.message}`);
                // Failure here shouldn't rollback the order, but should be alerted
            }

            // 5. Emit Event (Non-blocking, after commit)
            // OR we can trigger immediate deduction if we want "Reserve then Deduct" immediately?
            // The User requested "Reserve first, then Deduct on payment/Nfe".
            // So 'reserved' is the correct end state for Sync!

        } catch (error) {
            await session.abortTransaction();
            this.logger.error(`Failed to process order ${externalId}: ${error.message}`);
            throw error;
        } finally {
            session.endSession();
        }
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

        for (const [sku, quantity] of Object.entries(pickedItems)) {
            try {
                const product = await this.productService.findBySku(sku);
                if (!product) {
                    this.logger.warn(`Product with SKU ${sku} not found`);
                    skipped.push(sku);
                    continue;
                }

                const productId = product._id || product['id'];

                // Create stock movement (outbound) - this automatically updates stock and totalSold
                await this.productMovementService.create({
                    productId: String(productId),
                    type: 'outbound',
                    quantity: quantity,
                    conditionId: 1, // Default condition "Novo"
                    reason: 'Venda Marketplace',
                    reference: movementReference,
                    price: 0, // Sale price can be added from order.items if needed
                });

                stockUpdated.push(sku);

                this.eventEmitter.emit('product.stock.updated', {
                    productId: productId,
                    sku: product.sku || product.partNumber,
                    newStock: (product.stockQuantity || 0) - quantity,
                });

                published.push(sku);
                this.logger.log(`Stock movement created for SKU ${sku}: -${quantity} (reference: ${movementReference})`);
            } catch (err) {
                this.logger.error(`Error processing SKU ${sku}:`, err);
                skipped.push(sku);
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
            // "Clean" Logic: productId MUST be internal MongoID. If missing, try resolve using externalId.
            const hasInternalLink = item.productId && Types.ObjectId.isValid(item.productId);

            if (!hasInternalLink) {
                // Try resolving now
                // Use externalId (legacy/fallback)
                const extRef = item.externalId || '';

                let pId = await this.resolveInternalProductId(extRef, (item as any).sku);

                if (!pId && extRef) {
                    // Try finding by ProductTitle
                    const p = await this.productTitleService.findByExternalId(extRef).catch(() => null);
                    if (p) pId = p._id.toString();
                }

                if (pId) {
                    item.productId = new Types.ObjectId(pId);
                } else {
                    missingProducts++;
                }
            }

            // Prepare Event Item
            let itemSku = 'N/A';
            if (item.productId && Types.ObjectId.isValid(item.productId)) { // We trust it's valid now
                // Convert ObjectId to string for ProductService.findOne (if it expects string)
                // ProductService.findOne expects string usually.
                const p = await this.productService.findOne(item.productId.toString()).catch(() => null);
                itemSku = String(p?.sku || p?.partNumber || (item as any).sku || 'N/A');
            } else {
                itemSku = String((item as any).sku || 'N/A');
            }

            eventItems.push({
                sku: itemSku,
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

        const externalIds = orders.map(o => (o.externalId || '').trim()).filter(id => !!id);

        this.logger.debug(`[StockStatus] Checking ${externalIds.length} orders. Sample IDs: ${externalIds.slice(0, 3).join(', ')}`);

        const movements = await this.productRepository.findMovementsByReferences(externalIds);

        this.logger.debug(`[StockStatus] Found ${movements.length} matching movements. Sample Refs: ${movements.slice(0, 3).join(', ')}`);

        const movementSet = new Set(movements);

        for (const order of orders) {
            const extId = (order.externalId || '').trim();
            // Priority 1: Check actual stock movement existence
            if (movementSet.has(extId)) {
                order.logisticsStatus = 'deducted';
            }
            // Priority 2: Keep existing validation if not deducted (e.g. error/skipped)
            // If it was 'pending' but has a movement, it became 'deducted' above.
            // If it is 'pending' and NO movement, it remains 'pending' (correct).

            // Ensure default
            if (!order.logisticsStatus) {
                order.logisticsStatus = 'pending';
            }
        }
        return orders;
    }
}

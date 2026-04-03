import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { ProductMovementService } from '../../product/services/product-movement.service';
import { ProductRepository } from '../../product/product.repository';
import { OrderRepository } from '../order.repository';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class StockOrchestratorService {
    private readonly logger = new Logger(StockOrchestratorService.name);

    constructor(
        @Inject(forwardRef(() => ProductMovementService))
        private readonly productMovementService: ProductMovementService,
        @Inject(forwardRef(() => ProductRepository))
        private readonly productRepository: ProductRepository,
        private readonly orderRepository: OrderRepository,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    /**
     * Reserves stock for an order. 
     * Creates a 'reservation' stock movement.
     * This INCREASES 'stockReserved'. Stock is derived from stock_movements aggregation.
     */
    async reserveStock(items: { productId: string; quantity: number }[], reference: string, session?: any): Promise<boolean> {
        try {
            for (const item of items) {
                if (!item.productId) continue;

                // Create Reservation Movement
                await this.productMovementService.create({
                    productId: item.productId,
                    type: 'reservation',
                    quantity: item.quantity,
                    reason: 'Reserva de Pedido (Sync)',
                    reference: reference, // metadata.externalReference
                    origin: { type: 'system', location: 'Orchestrator' },
                    condition: 'new',
                }, session);

                this.logger.debug(`[Stock] Reserved ${item.quantity} for Product ${item.productId} (Ref: ${reference})`);
            }
            return true;
        } catch (err) {
            this.logger.error(`[Stock] Failed to reserve stock for ${reference}`, err);
            throw err;
        }
    }

    /**
     * Confirms a reservation by converting 'Reserved' to 'Deducted'.
     * Creates an 'outbound' movement (stock is derived from movements aggregation).
     * Passing isFulfillment: true ensures we also RELEASE the reservation (decrement stockReserved).
     */
    async confirmReservation(items: { productId: string; quantity: number }[], reference: string, session?: any) {
        try {
            for (const item of items) {
                if (!item.productId) continue;

                await this.productMovementService.create({
                    productId: item.productId,
                    type: 'outbound',
                    quantity: item.quantity,
                    reason: 'Venda Confirmada (Reserva Baixada)',
                    reference: reference,
                    condition: 'new',
                    metadata: {
                        isFulfillment: true
                    }
                }, session);

                this.logger.debug(`[Stock] Confirmed reservation for ${item.productId} (Ref: ${reference})`);
            }
        } catch (err) {
            this.logger.error(`[Stock] Failed to confirm reservation for ${reference}`, err);
            throw err;
        }
    }

    /**
     * Cancels a reservation.
     * Decrements 'stockReserved'.
     */
    async cancelReservation(items: { productId: string; quantity: number }[], reference: string, session?: any) {
        try {
            for (const item of items) {
                if (!item.productId) continue;
                await this.productRepository.updateStockReserved(item.productId, -item.quantity, session);
            }
        } catch (err) {
            this.logger.error(`[Stock] Failed to cancel reservation for ${reference}`, err);
        }
    }
    /**
     * Deducts stock within an EXTERNAL session provided by OrderSyncPipeline.
     * Returns movement IDs so the pipeline can link them to the order document atomically.
     * Idempotency: skips silently if reference already processed.
     */
    async deductAndLink(
        orderId: string,
        items: { productId: string; quantity: number }[],
        reference: string,
        marketplaceName: string,
        session: ClientSession,
    ): Promise<{ movementIds: string[] }> {
        const alreadyExists = await this.productMovementService.existsReference(reference);
        if (alreadyExists) {
            this.logger.warn(`[Stock] deductAndLink: ref ${reference} already processed. Skipping.`);
            return { movementIds: [] };
        }

        const movementIds: string[] = [];

        for (const item of items) {
            if (!item.productId || item.quantity <= 0) continue;

            const movement = await this.productMovementService.create({
                productId: item.productId,
                orderId,
                type: 'outbound',
                quantity: item.quantity,
                reason: `Venda ${marketplaceName}`,
                reference,
                condition: 'new',
                origin: { type: 'marketplace', location: marketplaceName },
                status: 'completed',
            }, session);

            movementIds.push(movement._id?.toString() ?? movement.id);
            this.logger.debug(`[Stock] deductAndLink: -${item.quantity} product=${item.productId} ref=${reference}`);
        }

        return { movementIds };
    }

    /**
     * Deducts stock directly (Atomic Transaction).
     * Used when proceeding directly from 'Pending' to 'Deducted' without reservation step.
     */
    async deductStock(orderId: string, items: { productId: string; quantity: number }[], reference: string, marketplaceName: string) {
        const session = await this.productRepository.getConnection().startSession();
        session.startTransaction();

        try {
            // 1. Idempotency Check (Pessimistic)
            const exists = await this.productMovementService.existsReference(reference);
            if (exists) {
                this.logger.warn(`[Stock] Deduction already processed for ref ${reference}. Skipping.`);
                await session.abortTransaction();
                return { status: 'skipped', reason: 'already_processed' };
            }

            // 2. Process Items
            const movements = [];
            const movementIds = [];

            for (const item of items) {
                if (!item.productId || item.quantity <= 0) continue;

                // Create outbound movement (stock derived from movements aggregation)
                const movement = await this.productMovementService.create({
                    productId: item.productId,
                    orderId: orderId, // Link to order (ObjectId)
                    type: 'outbound',
                    quantity: item.quantity,
                    reason: `Venda ${marketplaceName}`,
                    reference: reference,
                    condition: 'new',
                    origin: {
                        type: 'marketplace',
                        location: marketplaceName
                    },
                    status: 'completed'
                }, session);

                movements.push(movement);
                movementIds.push(movement._id || movement.id); // Collect IDs
            }

            // 3. Update Order Logistics Status to 'deducted' (Atomically)
            if (orderId && movementIds.length > 0) {
                // Convert IDs if needed (assume string or ObjectId)
                const finalMovementIds = movementIds.map(id => id);

                await this.orderRepository.updateOne(
                    { _id: orderId },
                    {
                        logisticsStatus: 'deducted',
                        processingStatus: 'completed',
                        $push: { stockMovementIds: { $each: finalMovementIds } } // Link movements to order
                    },
                    { session }
                );
            }

            await session.commitTransaction();

            // 4. Post-Commit: Emit Integation Events (RabbitMQ)
            for (const mov of movements) {
                this.eventEmitter.emit('product.movement_created', mov);
            }

            return { status: 'success', movementsCount: movements.length };

        } catch (err) {
            await session.abortTransaction();
            this.logger.error(`[Stock] Deduction failed for ${reference}`, err);
            throw err;
        } finally {
            session.endSession();
        }
    }
}

import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
     * This INCREASES 'stockReserved' but DOES NOT decrement 'stockQuantity'.
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
                    conditionId: 1
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
     * Creates an 'outbound' movement which decrements 'stockQuantity'.
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
                    conditionId: 1,
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
     * Deducts stock directly (Atomic Transaction).
     * Used used when proceeding directly from 'Pending' to 'Deducted' without reservation step.
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

                // Create Movement (decrements stockQuantity)
                const movement = await this.productMovementService.create({
                    productId: item.productId,
                    orderId: orderId, // Link to order (ObjectId)
                    type: 'outbound',
                    quantity: item.quantity,
                    reason: `Venda ${marketplaceName}`,
                    reference: reference,
                    conditionId: 1,
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

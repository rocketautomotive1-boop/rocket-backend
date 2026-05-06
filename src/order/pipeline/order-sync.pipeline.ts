import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OrderModel, OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { OrderMapperService } from '../services/order-mapper.service';
import { StockOrchestratorService } from '../services/stock-orchestrator.service';
import { MarketplaceOrderService } from '../../marketplace/services/marketplace-order.service';
import { ORDER_EVENTS, OrderProcessedEvent, OrderCancelledEvent } from '../events/order.events';
import { ProductMovementService } from '../../product/services/product-movement.service';

// Statuses that represent a confirmed sale — go directly to deduction
const CONFIRMED_STATUSES = new Set([
    'paid',
    'ready_to_ship',
    'shipped',
    'delivered',
    'payment_done',
]);

@Injectable()
export class OrderSyncPipeline {
    private readonly logger = new Logger(OrderSyncPipeline.name);

    constructor(
        @InjectModel(OrderModel.name)
        private readonly orderModel: Model<OrderDocument>,
        private readonly orderRepository: OrderRepository,
        private readonly orderMapper: OrderMapperService,
        @Inject(forwardRef(() => StockOrchestratorService))
        private readonly stockOrchestrator: StockOrchestratorService,
        @Inject(forwardRef(() => MarketplaceOrderService))
        private readonly marketplaceOrderService: MarketplaceOrderService,
        private readonly eventEmitter: EventEmitter2,
        private readonly amqpConnection: AmqpConnection,
        private readonly productMovementService: ProductMovementService,
    ) { }

    async execute(externalId: string, marketplaceId: string, source: 'webhook' | 'sync' | 'retry' | 'manual' = 'sync'): Promise<void> {
        this.logger.log(`[Pipeline] Starting sync for order ${externalId} (marketplace: ${marketplaceId})`);

        // ── PASSO 1: FETCH ────────────────────────────────────────────────────
        const externalOrder = await this.marketplaceOrderService.getOrderDetails(externalId, marketplaceId, { skipEnrichment: true });
        if (!externalOrder) {
            this.logger.warn(`[Pipeline] Order ${externalId} not found in marketplace. Aborting.`);
            return;
        }

        const marketplaceName: string = externalOrder.marketplaceName ?? 'Marketplace';
        const orderData = await this.orderMapper.mapToDomain(externalOrder, marketplaceId);

        const existing = await this.orderRepository.findByExternalId(externalId);

        // Guard de idempotência: estoque já deduzido.
        // Webhook pode ser apenas uma atualização de status (paid→shipped→delivered).
        // Nesse caso: atualiza status + histórico sem re-deduzir ou re-notificar.
        if (existing?.logisticsStatus === 'deducted') {
            const newStatus = (orderData.status ?? '').toLowerCase();
            const oldStatus = (existing.status ?? '').toLowerCase();

            if (newStatus !== oldStatus) {
                this.logger.log(`[Pipeline] Order ${externalId} status update: ${oldStatus} → ${newStatus}`);

                // Cancelamento de uma venda já processada — reverte estoque e notifica
                if (newStatus === 'cancelled') {
                    await this.handleCancellation(existing, externalId, marketplaceId, marketplaceName, externalOrder, source);
                    return;
                }

                // Atualização de status logístico puro — sem side-effects
                await this.orderModel.findByIdAndUpdate(existing._id, {
                    status: orderData.status,
                    syncedAt: new Date(),
                    $push: {
                        history: {
                            status: orderData.status,
                            at: new Date(),
                            trigger: 'webhook_status_update',
                            details: { previous: existing.status },
                        },
                    },
                });
                return;
            }

            // Mesmo status — verifica se notificação WhatsApp foi perdida
            const whatsappStatus = (existing as any)?.notificationStatus?.whatsapp?.status;
            if (['sent', 'skipped_old', 'manual_required'].includes(String(whatsappStatus || '').toLowerCase())) {
                this.logger.log(`[Pipeline] Order ${externalId} already deducted and notified. Skipping.`);
                return;
            }
            this.logger.log(`[Pipeline] Order ${externalId} deducted but notification missing — re-emitting PROCESSED.`);
            const recoveryEvent = new OrderProcessedEvent(
                existing._id.toString(),
                externalId,
                marketplaceId,
                existing.marketplaceData?.marketplaceName ?? marketplaceName,
                existing.items.map(i => ({
                    productId: i.productId?.toString() ?? '',
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                    sku: (i as any).sku ?? '',
                })),
                existing.totalAmount,
                'retry',
            );
            this.eventEmitter.emit(ORDER_EVENTS.PROCESSED, recoveryEvent);
            return;
        }

        // Determina se este status indica venda confirmada
        const isConfirmedSale = CONFIRMED_STATUSES.has((orderData.status ?? '').toLowerCase());

        // ── PASSO 2: REGISTER (transação atômica) ────────────────────────────
        const MAX_TX_RETRIES = 3;
        let txAttempt = 0;
        let savedOrder: OrderDocument;
        let movementIds: string[] = [];

        while (txAttempt < MAX_TX_RETRIES) {
        const session: ClientSession = await this.orderRepository.getConnection().startSession();
        let txSucceeded = false;

        let sessionEnded = false;
        try {
            session.startTransaction();

            // 2a. Upsert order
            if (existing) {
                Object.assign(existing, orderData);
                existing.logisticsStatus = isConfirmedSale ? 'processing' : 'pending';
                await existing.save({ session });
                savedOrder = existing;
            } else {
                const created = await this.orderModel.create(
                    [{ ...orderData, logisticsStatus: isConfirmedSale ? 'processing' : 'pending' }],
                    { session },
                );
                savedOrder = created[0];
            }

            // 2b. Deduz estoque (apenas para vendas confirmadas)
            if (isConfirmedSale) {
                const stockItems = savedOrder.items
                    .filter(i => i.productId)
                    .map(i => ({ productId: i.productId.toString(), quantity: i.quantity }));

                if (stockItems.length > 0) {
                    const result = await this.stockOrchestrator.deductAndLink(
                        savedOrder._id.toString(),
                        stockItems,
                        externalId,
                        marketplaceName,
                        session,
                    );
                    movementIds = result.movementIds;
                }

                // 2c. Atualiza status final do pedido
                if (movementIds.length > 0) {
                    // Movimentos criados — estoque deduzido com sucesso
                    savedOrder.logisticsStatus = 'deducted';
                    savedOrder.processingStatus = 'completed';
                    savedOrder.stockMovementIds = movementIds.map(id => new Types.ObjectId(id));
                } else {
                    // Nenhum movimento criado: ou todos os itens têm productId=null,
                    // ou a referência já foi processada antes (idempotência).
                    const hasAnyResolved = savedOrder.items.some(i => i.productId != null);
                    savedOrder.logisticsStatus = hasAnyResolved ? 'deducted' : 'unresolved';
                    savedOrder.processingStatus = 'completed';
                }
            }

            savedOrder.syncedAt = new Date();
            await savedOrder.save({ session });

            await session.commitTransaction();
            txSucceeded = true;
            this.logger.log(`[Pipeline] Order ${externalId} committed. logisticsStatus=${savedOrder.logisticsStatus}`);
        } catch (err) {
            await session.abortTransaction();
            const isWriteConflict = (err as any)?.code === 112 ||
                (err as Error).message?.includes('WriteConflict') ||
                (err as Error).message?.includes('retry your operation');

            if (isWriteConflict && txAttempt < MAX_TX_RETRIES - 1) {
                txAttempt++;
                const delay = txAttempt * 500;
                this.logger.warn(`[Pipeline] Write conflict for order ${externalId} — retry ${txAttempt}/${MAX_TX_RETRIES} in ${delay}ms`);
                sessionEnded = true;
                await session.endSession();
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            this.logger.error(`[Pipeline] Transaction aborted for order ${externalId}: ${(err as Error).message}`);
            throw err;
        } finally {
            if (!sessionEnded) {
                await session.endSession();
            }
        }

        if (txSucceeded) break;
        txAttempt++;
        } // end while

        // ── PASSO 3: PUBLISH (pós-commit) ─────────────────────────────────────
        if (!isConfirmedSale) {
            // Cancelamento direto (nunca foi deducted) — só notifica, sem reverter estoque
            if ((orderData.status ?? '').toLowerCase() === 'cancelled' && source === 'webhook') {
                const cancelDetail = externalOrder.original_data?.cancel_detail ?? (externalOrder as any).cancel_detail ?? null;
                const event = new OrderCancelledEvent(
                    savedOrder._id.toString(),
                    externalId,
                    marketplaceId,
                    marketplaceName,
                    savedOrder.totalAmount,
                    cancelDetail?.description ?? cancelDetail?.code ?? null,
                    cancelDetail?.requested_by ?? cancelDetail?.group ?? null,
                    false,
                    source as 'webhook' | 'sync',
                );
                this.eventEmitter.emit(ORDER_EVENTS.CANCELLED, event);
            }
            this.logger.log(`[Pipeline] Order ${externalId} saved as ${orderData.status}. No stock action.`);
            return;
        }

        const event = new OrderProcessedEvent(
            savedOrder._id.toString(),
            externalId,
            marketplaceId,
            marketplaceName,
            savedOrder.items.map(i => ({
                productId: i.productId?.toString() ?? '',
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                sku: (i as any).sku ?? '',
            })),
            savedOrder.totalAmount,
            source,
        );

        this.eventEmitter.emit(ORDER_EVENTS.PROCESSED, event);

        try {
            await this.amqpConnection.publish('rocket.orders', 'order.processed', event);
        } catch (mqErr) {
            // Não aborta — pedido e estoque já commitados
            this.logger.error(`[Pipeline] RabbitMQ publish failed for ${externalId}: ${(mqErr as Error).message}`);
        }
    }

    private async handleCancellation(
        existing: OrderDocument,
        externalId: string,
        marketplaceId: string,
        marketplaceName: string,
        externalOrder: any,
        source: string,
    ): Promise<void> {
        let stockReverted = false;

        // Reverte estoque: cria movimento inbound para cada item que tinha productId
        const itemsToRevert = existing.items.filter(i => i.productId);
        if (itemsToRevert.length > 0) {
            try {
                for (const item of itemsToRevert) {
                    await this.productMovementService.create({
                        productId: item.productId.toString(),
                        type: 'inbound',
                        quantity: item.quantity,
                        price: item.unitPrice,
                        orderId: existing._id.toString(),
                        reference: `cancel:${externalId}`,
                        notes: `Estorno por cancelamento do pedido ${externalId}`,
                    });
                }
                stockReverted = true;
                this.logger.log(`[Pipeline] Stock reverted for cancelled order ${externalId} (${itemsToRevert.length} items)`);
            } catch (err) {
                this.logger.error(`[Pipeline] Failed to revert stock for order ${externalId}: ${err.message}`);
            }
        }

        // Atualiza pedido no banco
        const cancelDetail = externalOrder.original_data?.cancel_detail ?? (externalOrder as any).cancel_detail ?? null;
        await this.orderModel.findByIdAndUpdate(existing._id, {
            status: 'cancelled',
            logisticsStatus: 'cancelled',
            syncedAt: new Date(),
            $push: {
                history: {
                    status: 'cancelled',
                    at: new Date(),
                    trigger: 'webhook_status_update',
                    details: {
                        previous: existing.status,
                        cancelDetail,
                        stockReverted,
                    },
                },
            },
        });

        // Emite evento para o listener de WhatsApp
        const event = new OrderCancelledEvent(
            existing._id.toString(),
            externalId,
            marketplaceId,
            marketplaceName,
            existing.totalAmount,
            cancelDetail?.description ?? cancelDetail?.code ?? null,
            cancelDetail?.requested_by ?? cancelDetail?.group ?? null,
            stockReverted,
            source as 'webhook' | 'sync',
        );
        this.eventEmitter.emit(ORDER_EVENTS.CANCELLED, event);
    }
}

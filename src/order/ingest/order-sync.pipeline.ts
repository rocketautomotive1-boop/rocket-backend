import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OrderModel, OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { OrderMapperService } from './order-mapper.service';
import { ORDER_EVENTS, OrderProcessedEvent, OrderCancelledEvent, OrderShippingUpdatedEvent, SHIPPING_MILESTONES } from '../events/order.events';
import { decideIngestAction, CONFIRMED_STATUSES, IngestSource } from './order-ingest.decision';
import { MARKETPLACE_ORDER_GATEWAY, MarketplaceOrderGateway } from '../ports/marketplace-order.gateway';
import { STOCK_LEDGER_PORT, StockLedgerPort } from '../ports/stock-ledger.port';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';

@Injectable()
export class OrderSyncPipeline {
    private readonly logger = new Logger(OrderSyncPipeline.name);

    constructor(
        @InjectModel(OrderModel.name)
        private readonly orderModel: Model<OrderDocument>,
        private readonly orderRepository: OrderRepository,
        private readonly orderMapper: OrderMapperService,
        @Inject(MARKETPLACE_ORDER_GATEWAY)
        private readonly gateway: MarketplaceOrderGateway,
        @Inject(STOCK_LEDGER_PORT)
        private readonly stock: StockLedgerPort,
        private readonly eventEmitter: EventEmitter2,
        private readonly amqpConnection: AmqpConnection,
        private readonly orchestratorPublisher: OrchestratorPublisherService,
    ) { }

    async execute(externalId: string, marketplaceId: string, source: IngestSource = 'sync', accountId?: string): Promise<void> {
        this.logger.log(`[Pipeline] Starting sync for order ${externalId} (marketplace: ${marketplaceId})${accountId ? ` account=${accountId}` : ''}`);

        // ── PASSO 1: FETCH ────────────────────────────────────────────────────
        const externalOrder = await this.gateway.fetchOrder(externalId, marketplaceId, accountId);
        if (!externalOrder) {
            this.logger.warn(`[Pipeline] Order ${externalId} not found in marketplace. Aborting.`);
            return;
        }

        const marketplaceName: string = externalOrder.marketplaceName ?? 'Marketplace';
        const orderData = await this.orderMapper.mapToDomain(externalOrder, marketplaceId);
        // Persiste a conta de origem (resolvida na borda) para que fulfillment/NF-e/
        // update-status usem a conta certa. Só sobrescreve quando resolvida.
        if (accountId) orderData.accountId = accountId;

        const existing = await this.orderRepository.findByExternalId(externalId);

        // ── PASSO 2: DECIDE (pure idempotency rules) ──────────────────────────
        const action = decideIngestAction(
            existing as any,
            { status: orderData.status, shippingSubstatus: orderData.shipping?.substatus },
            source,
        );
        this.logger.log(`[Pipeline] Order ${externalId} action=${action.kind} (existing=${!!existing})`);

        switch (action.kind) {
            case 'SKIP':
                this.logger.log(`[Pipeline] Order ${externalId} already deducted and notified. Skipping.`);
                return;

            case 'RECOVER_NOTIFICATION':
                this.emitRecovery(existing!, externalId, marketplaceId, marketplaceName);
                return;

            case 'UPDATE_STATUS':
                await this.applyStatusUpdate(existing!, orderData);
                return;

            case 'UPDATE_SHIPPING':
                await this.applyShippingUpdate(existing!, orderData, externalId, marketplaceId, marketplaceName, source);
                return;

            case 'CANCEL':
                await this.handleCancellation(existing!, externalId, marketplaceId, marketplaceName, externalOrder, source);
                return;

            case 'CREATE_PENDING':
                await this.registerAndPublish(existing, orderData, externalId, marketplaceId, marketplaceName, externalOrder, source, false);
                return;

            case 'CREATE_DEDUCT':
            case 'UPSERT_DEDUCT':
                await this.registerAndPublish(existing, orderData, externalId, marketplaceId, marketplaceName, externalOrder, source, true);
                return;
        }
    }

    /** Pure status-only update (deducted order, status changed, non-cancel). No side-effects. */
    private async applyStatusUpdate(existing: OrderDocument, orderData: any): Promise<void> {
        this.logger.log(`[Pipeline] Order ${existing.externalId} status update: ${existing.status} → ${orderData.status}`);
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
    }

    /**
     * Atualização de ENVIO (status comercial inalterado). Persiste o subdoc shipping +
     * append delta no history, e emite SHIPPING_UPDATED se o novo substatus for um marco.
     * Substatus fora dos marcos é salvo mas não notifica ("salvar tudo, notificar marcos").
     */
    private async applyShippingUpdate(
        existing: OrderDocument,
        orderData: any,
        externalId: string,
        marketplaceId: string,
        marketplaceName: string,
        source: IngestSource,
    ): Promise<void> {
        const sub = (orderData.shipping?.substatus ?? '').toLowerCase();
        const now = new Date();
        this.logger.log(`[Pipeline] Order ${externalId} shipping update: ${existing.shipping?.substatus ?? '∅'} → ${sub}`);

        const set: Record<string, any> = {
            'shipping.status': orderData.shipping?.status,
            'shipping.substatus': sub,
            'shipping.updatedAt': now,
            syncedAt: now,
        };
        if (orderData.shipping?.trackingCode) set['shipping.trackingCode'] = orderData.shipping.trackingCode;
        if (orderData.shipping?.estimatedDelivery) set['shipping.estimatedDelivery'] = orderData.shipping.estimatedDelivery;
        // Sempre seta (mesmo undefined) — expira/some do payload do ML quando o prazo passa,
        // e a trava de NF-e/etiqueta precisa refletir isso no próximo sync.
        set['shipping.scheduledShippingDate'] = orderData.shipping?.scheduledShippingDate ?? null;
        set['shipping.dateHandling'] = orderData.shipping?.dateHandling ?? null;
        set['shipping.handlingHours'] = orderData.shipping?.handlingHours ?? null;
        if (sub === 'delivered') set['shipping.deliveredAt'] = now;

        await this.orderModel.findByIdAndUpdate(existing._id, {
            $set: set,
            $push: { 'shipping.history': { substatus: sub, at: now } },
        });

        if (!SHIPPING_MILESTONES.has(sub)) {
            this.logger.log(`[Pipeline] Order ${externalId} shipping substatus '${sub}' não é marco — salvo sem notificar.`);
            return;
        }

        this.eventEmitter.emit(
            ORDER_EVENTS.SHIPPING_UPDATED,
            new OrderShippingUpdatedEvent(
                existing._id.toString(),
                externalId,
                marketplaceId,
                marketplaceName,
                sub,
                orderData.shipping?.trackingCode ?? existing.shipping?.trackingCode ?? null,
                source as any,
            ),
        );
    }

    /** Re-emit PROCESSED for an already-deducted order whose notification was lost. */
    private emitRecovery(existing: OrderDocument, externalId: string, marketplaceId: string, marketplaceName: string): void {
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
    }

    /** Upsert + (optionally) deduct stock atomically, then publish post-commit events. */
    private async registerAndPublish(
        existing: OrderDocument | null,
        orderData: any,
        externalId: string,
        marketplaceId: string,
        marketplaceName: string,
        externalOrder: any,
        source: IngestSource,
        isConfirmedSale: boolean,
    ): Promise<void> {
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
                    existing.reconcile = { lastCheckedAt: new Date(), detectedBy: source === 'reconcile' ? 'reconcile' : 'webhook' };
                    await existing.save({ session });
                    savedOrder = existing;
                } else {
                    const created = await this.orderModel.create(
                        [{
                            ...orderData,
                            logisticsStatus: isConfirmedSale ? 'processing' : 'pending',
                            reconcile: { lastCheckedAt: new Date(), detectedBy: source === 'reconcile' ? 'reconcile' : 'webhook' },
                        }],
                        { session },
                    );
                    savedOrder = created[0];
                }

                // 2b. Deduct stock (confirmed sales only)
                if (isConfirmedSale) {
                    const stockItems = savedOrder.items
                        .filter(i => i.productId)
                        .map(i => ({ productId: i.productId.toString(), quantity: i.quantity }));

                    if (stockItems.length > 0) {
                        const result = await this.stock.deductAndLink(
                            savedOrder._id.toString(),
                            stockItems,
                            externalId,
                            marketplaceName,
                            session,
                        );
                        movementIds = result.movementIds;
                    }

                    // 2c. Final logistics status
                    if (movementIds.length > 0) {
                        savedOrder.logisticsStatus = 'deducted';
                        savedOrder.processingStatus = 'completed';
                        savedOrder.stockMovementIds = movementIds.map(id => new Types.ObjectId(id));
                    } else {
                        const hasAnyResolved = savedOrder.items.some(i => i.productId != null);
                        savedOrder.logisticsStatus = hasAnyResolved ? 'deducted' : 'unresolved';
                        savedOrder.processingStatus = 'completed';
                    }

                    // 2d. Enqueue outbox sync within the same transaction (atomic with stock deduction)
                    if (movementIds.length > 0) {
                        const affected = [...new Set(
                            savedOrder.items.map(i => i.productId?.toString()).filter((id): id is string => !!id),
                        )];
                        for (const productId of affected) {
                            await this.orchestratorPublisher.requestSync(
                                { productId, reason: 'stock_deduction' },
                                session,
                            );
                        }
                    }
                }

                savedOrder.syncedAt = new Date();
                await savedOrder.save({ session });

                await session.commitTransaction();
                txSucceeded = true;
                this.logger.log(`[Pipeline] Order ${externalId} committed. logisticsStatus=${savedOrder.logisticsStatus}`);
            } catch (err) {
                // Only abort if the transaction is still open — commitTransaction() can throw
                // transiently after the commit already landed; aborting then would mask the
                // real error with "Cannot call abortTransaction after commitTransaction".
                if (session.inTransaction()) {
                    await session.abortTransaction();
                }
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
        }

        // ── PASSO 3: PUBLISH (pós-commit) ─────────────────────────────────────
        if (!isConfirmedSale) {
            // Direct cancellation (never deducted) — only notify, no stock revert.
            // Real-time (webhook/reconcile/gap-detector) notifica; só 'sync' fica silencioso.
            if ((orderData.status ?? '').toLowerCase() === 'cancelled' && source !== 'sync') {
                const cancelDetail = externalOrder.original_data?.cancel_detail ?? externalOrder.cancel_detail ?? null;
                const ctx = this.cancelItemContext(savedOrder.items, orderData.marketplaceCreatedAt);
                const event = new OrderCancelledEvent(
                    savedOrder._id.toString(),
                    externalId,
                    marketplaceId,
                    marketplaceName,
                    savedOrder.totalAmount,
                    cancelDetail?.description ?? cancelDetail?.code ?? null,
                    cancelDetail?.requested_by ?? cancelDetail?.group ?? null,
                    false,
                    source as any,
                    ctx.firstItemTitle,
                    ctx.firstQty,
                    ctx.extraItemsCount,
                    ctx.soldAt,
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
            source as any,
        );

        this.eventEmitter.emit(ORDER_EVENTS.PROCESSED, event);

        try {
            await this.amqpConnection.publish('rocket.orders', 'order.processed', event);
        } catch (mqErr) {
            // Don't abort — order + stock already committed
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

        // Revert stock: inbound movement for each item that had a productId
        const itemsToRevert = existing.items.filter(i => i.productId);
        if (itemsToRevert.length > 0) {
            try {
                await this.stock.revert(
                    existing._id.toString(),
                    itemsToRevert.map(i => ({
                        productId: i.productId.toString(),
                        quantity: i.quantity,
                        unitPrice: i.unitPrice,
                    })),
                    `cancel:${externalId}`,
                );
                stockReverted = true;
                this.logger.log(`[Pipeline] Stock reverted for cancelled order ${externalId} (${itemsToRevert.length} items)`);
            } catch (err) {
                this.logger.error(`[Pipeline] Failed to revert stock for order ${externalId}: ${(err as Error).message}`);
            }
        }

        const cancelDetail = externalOrder.original_data?.cancel_detail ?? externalOrder.cancel_detail ?? null;
        await this.orderModel.findByIdAndUpdate(existing._id, {
            status: 'cancelled',
            logisticsStatus: 'cancelled',
            syncedAt: new Date(),
            // Sem isso, shipping.status/substatus fica congelado no valor pré-cancelamento
            // (ex.: pending/buffered) e a UI segue mostrando "Para enviar em breve" para um
            // pedido cancelado — bug confirmado em produção.
            'shipping.status': 'cancelled',
            'shipping.substatus': 'cancelled',
            $push: {
                history: {
                    status: 'cancelled',
                    at: new Date(),
                    trigger: 'webhook_status_update',
                    details: { previous: existing.status, cancelDetail, stockReverted },
                },
            },
        });

        const ctx = this.cancelItemContext(existing.items, (existing as any).marketplaceCreatedAt);
        const event = new OrderCancelledEvent(
            existing._id.toString(),
            externalId,
            marketplaceId,
            marketplaceName,
            existing.totalAmount,
            cancelDetail?.description ?? cancelDetail?.code ?? null,
            cancelDetail?.requested_by ?? cancelDetail?.group ?? null,
            stockReverted,
            source as any,
            ctx.firstItemTitle,
            ctx.firstQty,
            ctx.extraItemsCount,
            ctx.soldAt,
        );
        this.eventEmitter.emit(ORDER_EVENTS.CANCELLED, event);
    }

    /** Extrai contexto do 1º item + data real da venda para a mensagem de cancelamento. */
    private cancelItemContext(
        items: Array<{ title?: string; quantity?: number }> | undefined,
        marketplaceCreatedAt?: Date | string | null,
    ): { firstItemTitle?: string; firstQty?: number; extraItemsCount?: number; soldAt?: string | null } {
        const list = items ?? [];
        const first = list[0];
        return {
            firstItemTitle: first?.title,
            firstQty: first?.quantity,
            extraItemsCount: Math.max(0, list.length - 1),
            soldAt: marketplaceCreatedAt
                ? new Date(marketplaceCreatedAt).toISOString()
                : null,
        };
    }
}

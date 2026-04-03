import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { OrderModel, OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { ProductMatcherService } from '../../product/services/product-matcher.service';
import { StockOrchestratorService } from './stock-orchestrator.service';
import { Result } from '../../common/utils/result.util';

const RECTIFY_BATCH_SIZE = 20;

const CONFIRMED_STATUSES = new Set([
    'paid',
    'ready_to_ship',
    'shipped',
    'delivered',
    'payment_done',
]);

export interface RectifyResult {
    orderId: string;
    externalId: string;
    resolved: number;
    stillUnresolved: number;
    movementsCreated: number;
    finalStatus: string;
}

export interface BulkRectifyResult {
    total: number;
    succeeded: number;
    failed: number;
    totalMovementsCreated: number;
}

@Injectable()
export class OrderRectifyService {
    private readonly logger = new Logger(OrderRectifyService.name);

    constructor(
        @InjectModel(OrderModel.name)
        private readonly orderModel: Model<OrderDocument>,
        private readonly orderRepository: OrderRepository,
        private readonly productMatcher: ProductMatcherService,
        private readonly stockOrchestrator: StockOrchestratorService,
    ) { }

    /**
     * Retorna pedidos que possuem ao menos um item com productId === null.
     * Útil para listar pedidos pendentes de retificação.
     */
    async findUnresolved(marketplaceId?: string): Promise<any[]> {
        const query: any = { 'items.productId': null };
        if (marketplaceId) {
            query.marketplaceId = new Types.ObjectId(marketplaceId);
        }
        return this.orderModel
            .find(query)
            .select('_id externalId marketplaceId status logisticsStatus items stockMovementIds syncedAt')
            .lean()
            .exec();
    }

    /**
     * Re-resolve productIds de um pedido individual, criando os movimentos de estoque faltantes.
     * Idempotente: pode ser chamado múltiplas vezes sem duplicar movimentos.
     */
    async rectifyOrder(orderId: string): Promise<Result<RectifyResult>> {
        const order = await this.orderRepository.findById(orderId);
        if (!order) {
            return Result.fail(`Order ${orderId} not found`);
        }

        // Já totalmente deduzido — nada a fazer
        if (order.logisticsStatus === 'deducted' && (order.stockMovementIds ?? []).length > 0) {
            const resolvedCount = order.items.filter(i => i.productId != null).length;
            return Result.ok({
                orderId,
                externalId: order.externalId,
                resolved: resolvedCount,
                stillUnresolved: order.items.length - resolvedCount,
                movementsCreated: 0,
                finalStatus: 'deducted',
            });
        }

        const marketplaceId = order.marketplaceId.toString();
        let anyNewlyResolved = false;

        // Re-resolve apenas os itens com productId === null
        for (const item of order.items) {
            if (item.productId) continue;

            const pId = await this.productMatcher.resolveProduct(
                (item as any).externalId ?? '',
                (item as any).sku ?? '',
                marketplaceId,
                item.title,
            );

            if (pId && Types.ObjectId.isValid(pId)) {
                item.productId = new Types.ObjectId(pId);
                anyNewlyResolved = true;
                this.logger.log(`[Rectify] Order ${order.externalId}: item "${item.title}" resolved -> ${pId}`);
            }
        }

        const resolvedCount = order.items.filter(i => i.productId != null).length;
        const unresolvedCount = order.items.filter(i => i.productId == null).length;

        let movementsCreated = 0;
        const isConfirmed = CONFIRMED_STATUSES.has((order.status ?? '').toLowerCase());

        // Cria movimentos apenas para itens recém-resolvidos em pedidos confirmados
        if (isConfirmed && anyNewlyResolved) {
            const stockItems = order.items
                .filter(i => i.productId)
                .map(i => ({ productId: i.productId.toString(), quantity: i.quantity }));

            if (stockItems.length > 0) {
                const session: ClientSession = await this.orderRepository.getConnection().startSession();
                try {
                    session.startTransaction();

                    const result = await this.stockOrchestrator.deductAndLink(
                        orderId,
                        stockItems,
                        order.externalId,
                        'Retificação',
                        session,
                    );
                    movementsCreated = result.movementIds.length;

                    if (result.movementIds.length > 0) {
                        order.stockMovementIds = [
                            ...(order.stockMovementIds ?? []),
                            ...result.movementIds.map(id => new Types.ObjectId(id)),
                        ];
                    }

                    await session.commitTransaction();
                } catch (err) {
                    await session.abortTransaction();
                    this.logger.error(
                        `[Rectify] Falha na dedução de estoque para ${order.externalId}: ${(err as Error).message}`,
                    );
                    // Salva os productIds resolvidos mesmo se a dedução falhar
                } finally {
                    session.endSession();
                }
            }
        }

        // Determina status final
        const finalStatus = unresolvedCount === 0 ? 'deducted' : 'unresolved';
        order.logisticsStatus = finalStatus;
        if (unresolvedCount === 0 && isConfirmed) {
            order.processingStatus = 'completed';
        }

        await order.save();

        return Result.ok({
            orderId,
            externalId: order.externalId,
            resolved: resolvedCount,
            stillUnresolved: unresolvedCount,
            movementsCreated,
            finalStatus,
        });
    }

    /**
     * Retifica todos os pedidos não resolvidos em batches de RECTIFY_BATCH_SIZE.
     * Retorna um sumário com total, sucedidos, falhos e movimentos criados.
     */
    async bulkRectify(marketplaceId?: string): Promise<Result<BulkRectifyResult>> {
        const unresolved = await this.findUnresolved(marketplaceId);
        this.logger.log(`[Rectify] Bulk: ${unresolved.length} pedidos não resolvidos encontrados`);

        let succeeded = 0;
        let failed = 0;
        let totalMovementsCreated = 0;

        for (let i = 0; i < unresolved.length; i += RECTIFY_BATCH_SIZE) {
            const batch = unresolved.slice(i, i + RECTIFY_BATCH_SIZE);

            await Promise.all(
                batch.map(async (order: any) => {
                    const result = await this.rectifyOrder(order._id.toString());
                    if (result.isSuccess) {
                        succeeded++;
                        totalMovementsCreated += result.getValue().movementsCreated;
                    } else {
                        failed++;
                        this.logger.warn(
                            `[Rectify] Falha no pedido ${order.externalId}: ${result.error}`,
                        );
                    }
                }),
            );

            this.logger.log(
                `[Rectify] Batch ${Math.floor(i / RECTIFY_BATCH_SIZE) + 1} concluído`,
            );
        }

        return Result.ok({
            total: unresolved.length,
            succeeded,
            failed,
            totalMovementsCreated,
        });
    }
}

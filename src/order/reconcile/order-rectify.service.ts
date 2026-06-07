import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, ClientSession } from 'mongoose';
import { OrderModel, OrderDocument } from '../schemas/order.schema';
import { OrderRepository } from '../order.repository';
import { PRODUCT_RESOLVER_PORT, ProductResolverPort } from '../ports/product-resolver.port';
import { STOCK_LEDGER_PORT, StockLedgerPort } from '../ports/stock-ledger.port';
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
        @Inject(PRODUCT_RESOLVER_PORT)
        private readonly resolver: ProductResolverPort,
        @Inject(STOCK_LEDGER_PORT)
        private readonly stock: StockLedgerPort,
    ) { }

    /**
     * Returns orders that have at least one item with productId === null.
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
     * Re-resolves productIds of a single order, creating missing stock movements.
     * Idempotent: can be called multiple times without duplicating movements.
     */
    async rectifyOrder(orderId: string): Promise<Result<RectifyResult>> {
        const order = await this.orderRepository.findById(orderId);
        if (!order) {
            return Result.fail(`Order ${orderId} not found`);
        }

        // Already fully deducted — nothing to do
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

        // Re-resolve only items with productId === null
        for (const item of order.items) {
            if (item.productId) continue;

            const pId = await this.resolver.resolveProduct(
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

        // Create movements only for newly-resolved items in confirmed orders
        if (isConfirmed && anyNewlyResolved) {
            const stockItems = order.items
                .filter(i => i.productId)
                .map(i => ({ productId: i.productId.toString(), quantity: i.quantity }));

            if (stockItems.length > 0) {
                const session: ClientSession = await this.orderRepository.getConnection().startSession();
                try {
                    session.startTransaction();

                    const result = await this.stock.deductAndLink(
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
                    if (session.inTransaction()) {
                        await session.abortTransaction();
                    }
                    this.logger.error(
                        `[Rectify] Stock deduction failed for ${order.externalId}: ${(err as Error).message}`,
                    );
                    // Save resolved productIds even if deduction fails
                } finally {
                    session.endSession();
                }
            }
        }

        // Determine final status
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
     * Rectifies all unresolved orders in batches of RECTIFY_BATCH_SIZE.
     */
    async bulkRectify(marketplaceId?: string): Promise<Result<BulkRectifyResult>> {
        const unresolved = await this.findUnresolved(marketplaceId);
        this.logger.log(`[Rectify] Bulk: ${unresolved.length} unresolved orders found`);

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
                            `[Rectify] Failed for order ${order.externalId}: ${result.error}`,
                        );
                    }
                }),
            );

            this.logger.log(
                `[Rectify] Batch ${Math.floor(i / RECTIFY_BATCH_SIZE) + 1} done`,
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

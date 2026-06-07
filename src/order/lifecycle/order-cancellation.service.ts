import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderModel, OrderDocument } from '../schemas/order.schema';
import { ORDER_EVENTS, OrderCancelledEvent } from '../events/order.events';
import { STOCK_LEDGER_PORT, StockLedgerPort } from '../ports/stock-ledger.port';

export interface CancellationResult {
  stockReverted: boolean;
  notified: boolean;
}

@Injectable()
export class OrderCancellationService {
  private readonly logger = new Logger(OrderCancellationService.name);

  constructor(
    @InjectModel(OrderModel.name) private readonly orderModel: Model<OrderDocument>,
    @Inject(STOCK_LEDGER_PORT) private readonly stock: StockLedgerPort,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Lists orders with a cancellation inconsistency:
   * - status=cancelled but logisticsStatus=deducted → stock was not reverted
   * - status=cancelled but logisticsStatus != 'cancelled' → logistics not updated
   */
  async findInconsistentCancellations(lookbackDays = 30): Promise<{
    pendingRevert: any[];
    summary: { total: number };
  }> {
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    const orders = await this.orderModel.find({
      status: 'cancelled',
      logisticsStatus: { $in: ['deducted', 'processing', 'pending', 'unresolved'] },
      createdAt: { $gte: since },
    }, {
      externalId: 1, status: 1, logisticsStatus: 1, totalAmount: 1, createdAt: 1,
      'items.title': 1, 'items.quantity': 1, 'items.productId': 1,
    }).sort({ createdAt: -1 }).lean().exec();

    return {
      pendingRevert: orders.map(o => ({
        id: o._id,
        externalId: o.externalId,
        logisticsStatus: o.logisticsStatus,
        totalAmount: o.totalAmount,
        createdAt: (o as any).createdAt,
        itemsWithStock: o.items?.filter((i: any) => i.productId).length ?? 0,
      })),
      summary: { total: orders.length },
    };
  }

  /** Bulk-fix all cancelled orders with inconsistent stock. */
  async fixInconsistentCancellations(lookbackDays = 30): Promise<{
    processed: number;
    stockReverted: number;
    errors: string[];
  }> {
    const { pendingRevert } = await this.findInconsistentCancellations(lookbackDays);
    let stockReverted = 0;
    const errors: string[] = [];

    for (const entry of pendingRevert) {
      try {
        const order = await this.orderModel.findById(entry.id).exec();
        if (!order) continue;
        const result = await this.process(order, {}, 'sync'); // 'sync' → no WhatsApp notification
        if (result.stockReverted) stockReverted++;
      } catch (err) {
        errors.push(`${entry.externalId}: ${(err as Error).message}`);
        this.logger.error(`Failed to fix cancellation for ${entry.externalId}: ${(err as Error).message}`);
      }
    }

    return { processed: pendingRevert.length, stockReverted, errors };
  }

  /**
   * Processes a cancellation:
   * - reverts stock if still deducted
   * - updates logisticsStatus to 'cancelled'
   * - emits ORDER_CANCELLED for WhatsApp notification
   */
  async process(
    order: OrderDocument,
    cancelDetail: { reason?: string | null; cancelledBy?: string | null } = {},
    triggeredBy: 'webhook' | 'sync' = 'webhook',
  ): Promise<CancellationResult> {
    let stockReverted = false;

    // Revert stock only if still deducted (avoids double-revert)
    if (order.logisticsStatus === 'deducted') {
      const itemsToRevert = order.items.filter(i => i.productId);
      if (itemsToRevert.length > 0) {
        try {
          await this.stock.revert(
            order._id.toString(),
            itemsToRevert.map(i => ({
              productId: i.productId.toString(),
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
            `cancel:${order.externalId}`,
          );
          stockReverted = true;
          this.logger.log(`Stock reverted for order ${order.externalId} (${itemsToRevert.length} items)`);
        } catch (err) {
          this.logger.error(`Failed to revert stock for order ${order.externalId}: ${(err as Error).message}`);
        }
      }

      await this.orderModel.findByIdAndUpdate(order._id, {
        status: 'cancelled',
        logisticsStatus: 'cancelled',
        syncedAt: new Date(),
        $push: {
          history: {
            status: 'cancelled',
            at: new Date(),
            trigger: triggeredBy === 'webhook' ? 'webhook_status_update' : 'manual_reprocess',
            details: { previous: order.status, stockReverted, cancelDetail },
          },
        },
      });
    }

    // Emit event — WhatsAppCancellationListener notifies when triggeredBy === 'webhook'
    const event = new OrderCancelledEvent(
      order._id.toString(),
      order.externalId,
      order.marketplaceId.toString(),
      '',
      order.totalAmount,
      cancelDetail.reason ?? null,
      cancelDetail.cancelledBy ?? null,
      stockReverted,
      triggeredBy,
    );
    this.eventEmitter.emit(ORDER_EVENTS.CANCELLED, event);

    return { stockReverted, notified: triggeredBy === 'webhook' };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderModel, OrderDocument } from '../schemas/order.schema';
import { ORDER_EVENTS, OrderCancelledEvent } from '../events/order.events';
import { ProductMovementService } from '../../product/services/product-movement.service';

export interface CancellationResult {
  stockReverted: boolean;
  notified: boolean;
}

@Injectable()
export class OrderCancellationService {
  private readonly logger = new Logger(OrderCancellationService.name);

  constructor(
    @InjectModel(OrderModel.name) private readonly orderModel: Model<OrderDocument>,
    private readonly productMovementService: ProductMovementService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Lista pedidos com inconsistência de cancelamento:
   * - status=cancelled mas logisticsStatus=deducted → estoque não foi revertido
   * - status=cancelled mas logisticsStatus != 'cancelled' → logística não atualizada
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

  /**
   * Corrige em lote todos os pedidos cancelados com estoque inconsistente.
   */
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
        const result = await this.process(order, {}, 'sync'); // 'sync' → sem notificação WhatsApp
        if (result.stockReverted) stockReverted++;
      } catch (err) {
        errors.push(`${entry.externalId}: ${err.message}`);
        this.logger.error(`Failed to fix cancellation for ${entry.externalId}: ${err.message}`);
      }
    }

    return { processed: pendingRevert.length, stockReverted, errors };
  }

  /**
   * Processa o cancelamento de um pedido:
   * - Reverte estoque se ainda estava deducted
   * - Atualiza logisticsStatus para 'cancelled'
   * - Emite ORDER_CANCELLED para notificação WhatsApp
   */
  async process(
    order: OrderDocument,
    cancelDetail: { reason?: string | null; cancelledBy?: string | null } = {},
    triggeredBy: 'webhook' | 'sync' = 'webhook',
  ): Promise<CancellationResult> {
    let stockReverted = false;

    // Reverte estoque apenas se ainda estava deducted (evita reverter duas vezes)
    if (order.logisticsStatus === 'deducted') {
      const itemsToRevert = order.items.filter(i => i.productId);
      if (itemsToRevert.length > 0) {
        try {
          for (const item of itemsToRevert) {
            await this.productMovementService.create({
              productId: item.productId.toString(),
              type: 'inbound',
              quantity: item.quantity,
              price: item.unitPrice,
              orderId: order._id.toString(),
              reference: `cancel:${order.externalId}`,
              notes: `Estorno por cancelamento do pedido ${order.externalId}`,
            });
          }
          stockReverted = true;
          this.logger.log(`Stock reverted for order ${order.externalId} (${itemsToRevert.length} items)`);
        } catch (err) {
          this.logger.error(`Failed to revert stock for order ${order.externalId}: ${err.message}`);
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

    // Emite evento — o WhatsAppCancellationListener notifica se triggeredBy === 'webhook'
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

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderModel } from '../schemas/order.schema';
import { OrderPricingService } from '../services/order-pricing.service';
import { ORDER_EVENTS, OrderPricingCalculatedEvent } from '../events/order.events';

/**
 * Listener que dispara cálculo de pricing após ORDER_PROCESSED
 * Escuta o evento, calcula margem/lucro, salva no order, emite novo evento
 */
@Injectable()
export class OrderPricingListener {
  private logger = new Logger(OrderPricingListener.name);

  constructor(
    @InjectModel('OrderModel') private orderModel: Model<OrderModel>,
    private pricingService: OrderPricingService,
    private eventEmitter: EventEmitter2
  ) {}

  /**
   * Escuta ORDER_EVENTS.PROCESSED e calcula pricing
   */
  @OnEvent(ORDER_EVENTS.PROCESSED, { async: true })
  async handleOrderProcessed(event: any): Promise<void> {
    const { orderId, externalId, marketplaceId, marketplaceName, triggeredBy } = event;

    try {
      this.logger.debug(`Starting pricing calculation for order ${orderId}`);

      // Validar marketplace name
      if (!marketplaceName || typeof marketplaceName !== 'string') {
        this.logger.warn(
          `Order ${orderId} has invalid marketplaceName: ${JSON.stringify(marketplaceName)}. Skipping pricing calculation.`
        );
        return;
      }

      // 1. Carregar order completo do banco
      const order = await this.orderModel.findById(orderId).lean().exec();

      if (!order) {
        this.logger.warn(`Order ${orderId} not found during pricing calculation`);
        return;
      }

      // 2. Calcular pricing
      const pricingDetail = await this.pricingService.calculateOrderProfitability(
        order as any,
        marketplaceName
      );

      // 3. Salvar pricing no order document
      await this.orderModel.findByIdAndUpdate(
        orderId,
        { pricing: pricingDetail },
        { new: true }
      );

      this.logger.debug(
        `Pricing calculated for order ${orderId}: netProfit=${pricingDetail.totals.totalNetProfit}`
      );

      // 4. Emitir evento PRICING_CALCULATED para notificações, etc
      const pricingEvent = new OrderPricingCalculatedEvent(
        orderId,
        externalId,
        marketplaceId,
        marketplaceName,
        pricingDetail,
        triggeredBy ?? 'sync',
      );

      this.eventEmitter.emit(ORDER_EVENTS.PRICING_CALCULATED, pricingEvent);

    } catch (error) {
      this.logger.error(
        `Error calculating pricing for order ${orderId}: ${error.message}`,
        error.stack
      );
      // NÃO falha a order se pricing falhar - é non-critical
    }
  }
}

import { Controller, Post, Body, Param, Logger, HttpCode } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderPricingService } from '../services/order-pricing.service';
import { ORDER_EVENTS } from '../events/order.events';

/**
 * Controller para operações de teste e debug de Orders
 * Endpoints para emitir manualmente eventos, recalcular pricing, reenviar notificações
 */
@Controller('orders/test')
export class OrderTestController {
  private logger = new Logger(OrderTestController.name);

  constructor(
    @InjectModel('OrderModel') private orderModel: Model<any>,
    private orderPricingService: OrderPricingService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * POST /orders/test/process-event
   * Dispara manualmente o evento ORDER_PROCESSED para uma order
   * Útil para simular o webhook do marketplace
   *
   * Body esperado:
   * {
   *   "orderId": "order_mongo_id",
   *   "externalId": "MLB12345678",
   *   "marketplaceId": "marketplace_id",
   *   "marketplaceName": "Mercado Livre"
   * }
   */
  @Post('process-event')
  @HttpCode(202)
  async testProcessEvent(
    @Body()
    body: {
      orderId?: string;
      externalId: string;
      marketplaceId: string;
      marketplaceName: string;
    }
  ) {
    const { orderId, externalId, marketplaceId, marketplaceName } = body;

    // Validar dados obrigatórios
    if (!externalId || !marketplaceId || !marketplaceName) {
      return {
        ok: false,
        error: 'Missing required fields: externalId, marketplaceId, marketplaceName',
        example: {
          orderId: '507f1f77bcf86cd799439011',
          externalId: 'MLB123456789',
          marketplaceId: '1',
          marketplaceName: 'Mercado Livre',
        }
      };
    }

    // Se orderId não foi fornecido, buscar uma order com esse externalId
    let finalOrderId = orderId;
    if (!orderId) {
      try {
        const existingOrder = await this.orderModel.findOne({ externalId }).exec();
        if (existingOrder) {
          finalOrderId = existingOrder._id.toString();
        } else {
          return {
            ok: false,
            error: `No order found with externalId ${externalId}. Provide orderId or create a test order first.`,
          };
        }
      } catch (err) {
        this.logger.error(`Error looking up order: ${err.message}`);
      }
    }

    this.logger.log(
      `[TEST] Emitting ORDER_PROCESSED event for ${externalId} (orderId: ${finalOrderId}, marketplace: ${marketplaceName})`
    );

    // Emitir com dados validados
    this.eventEmitter.emit(ORDER_EVENTS.PROCESSED, {
      orderId: finalOrderId,
      externalId,
      marketplaceId,
      marketplaceName,
      items: [],  // Fornece array vazio para não quebrar listeners
      totalAmount: 0,
      triggeredBy: 'test',
    });

    return {
      ok: true,
      message: 'Evento ORDER_PROCESSED disparado com sucesso',
      data: { orderId: finalOrderId, externalId, marketplaceName },
    };
  }

  /**
   * POST /orders/test/:orderId/recalculate-pricing
   * Recalcula o pricing de uma order existente e reemite o evento de notificação
   * Útil se o pricing falhou na primeira vez ou para debugar
   */
  @Post(':orderId/recalculate-pricing')
  @HttpCode(200)
  async recalculatePricing(
    @Param('orderId') orderId: string,
    @Body() body?: { marketplaceName?: string }
  ) {
    try {
      // 1. Carregar order do banco
      const order = await this.orderModel.findById(orderId).lean().exec();

      if (!order) {
        return {
          ok: false,
          error: `Order ${orderId} não encontrada`,
        };
      }

      // 2. Obter marketplace name (da order ou do body)
      const marketplaceName = body?.marketplaceName || 'mercadolivre';

      this.logger.log(
        `[TEST] Recalculating pricing for order ${orderId} (marketplace: ${marketplaceName})`
      );

      // 3. Recalcular pricing
      const pricing = await this.orderPricingService.calculateOrderProfitability(
        order as any,
        marketplaceName
      );

      // 4. Salvar no banco
      const updated = await this.orderModel.findByIdAndUpdate(
        orderId,
        { pricing },
        { new: true }
      );

      // 5. Emitir evento PRICING_CALCULATED para disparar notificação WhatsApp
      this.logger.log(`[TEST] Emitting ORDER_PRICING_CALCULATED event`);
      this.eventEmitter.emit(ORDER_EVENTS.PRICING_CALCULATED, {
        orderId,
        externalId: order.externalId,
        marketplaceId: order.marketplaceId,
        marketplaceName,
        pricing,
      });

      return {
        ok: true,
        message: 'Pricing recalculado e notificação enfileirada com sucesso',
        data: {
          orderId,
          externalId: order.externalId,
          marketplace: marketplaceName,
          pricing: {
            totals: pricing.totals,
          },
        },
      };

    } catch (error) {
      this.logger.error(`Error recalculating pricing: ${error.message}`);
      return {
        ok: false,
        error: error.message,
      };
    }
  }

  /**
   * GET /orders/test/status/pricing
   * Retorna status de ordens com/sem pricing calculado
   */
  @Post('status/pricing')
  @HttpCode(200)
  async getPricingStatus() {
    try {
      const withPricing = await this.orderModel
        .countDocuments({ pricing: { $exists: true, $ne: null } })
        .exec();

      const withoutPricing = await this.orderModel
        .countDocuments({ $or: [{ pricing: null }, { pricing: { $exists: false } }] })
        .exec();

      const recent = await this.orderModel
        .find({ pricing: { $exists: true, $ne: null } })
        .sort({ 'pricing.calculatedAt': -1 })
        .limit(5)
        .lean()
        .exec();

      return {
        ok: true,
        summary: {
          withPricing,
          withoutPricing,
          total: withPricing + withoutPricing,
          percentageComplete: (withPricing / (withPricing + withoutPricing) * 100).toFixed(2) + '%',
        },
        recent: recent.map(o => ({
          externalId: o.externalId,
          calculatedAt: o.pricing?.calculatedAt,
          netProfit: o.pricing?.totals?.totalNetProfit,
          marginPercent: o.pricing?.totals?.profitMarginPercent,
        })),
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
      };
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PricingCalculatorRegistry } from '../registries/pricing-calculator.registry';
import { OrderModel } from '../schemas/order.schema';
import {
  OrderItemPricingDto,
  OrderPricingDetailDto,
  OrderPricingTotalsDto,
} from '../dto/order-pricing-detail.dto';

/**
 * Serviço centralizador de cálculo de margens e lucros
 * Suporta múltiplos marketplaces via Strategy Pattern
 */
@Injectable()
export class OrderPricingService {
  private logger = new Logger(OrderPricingService.name);

  constructor(private pricingRegistry: PricingCalculatorRegistry) {}

  /**
   * Calcula profitabilidade completa de uma order
   * @param order Order document do MongoDB
   * @param marketplaceName Nome do marketplace (e.g., 'mercadolivre')
   * @returns OrderPricingDetailDto com breakdown completo
   */
  async calculateOrderProfitability(
    order: any, // Lean document - pode conter _id e createdAt
    marketplaceName: string
  ): Promise<OrderPricingDetailDto> {
    this.logger.debug(
      `Calculating profitability for order ${order._id} from ${marketplaceName}`
    );

    // 1. Obter estratégia do marketplace
    let strategy = this.pricingRegistry.get(marketplaceName);
    if (!strategy) {
      this.logger.warn(
        `No pricing calculator found for marketplace: ${marketplaceName}. Using generic calculator. Available: ${this.pricingRegistry.list().join(', ')}`
      );
      strategy = this.pricingRegistry.get('GENERIC');
      if (!strategy) {
        throw new Error(`No pricing calculator found for marketplace: ${marketplaceName} and generic fallback not available`);
      }
    }

    // 2. Calcular pricing por item
    const itemPricings: OrderItemPricingDto[] = [];

    for (const item of order.items) {
      const itemPricing = await this.calculateItemPricing(item, strategy, order);
      itemPricings.push(itemPricing);
    }

    // 3. Calcular totais agregados
    const totals = this.calculateTotals(itemPricings, order);

    // 4. Preparar resposta
    const result: OrderPricingDetailDto = {
      orderId: order._id?.toString?.() || order._id,
      externalId: order.externalId,
      marketplace: marketplaceName,
      createdAt: order.createdAt || new Date(),
      items: itemPricings,
      totals,
      strategy: strategy.getName(),
      calculatedAt: new Date(),
    };

    this.logger.debug(`Profitability calculated: netProfit=${totals.totalNetProfit}`);

    return result;
  }

  /**
   * Calcula pricing para um item individual
   */
  private async calculateItemPricing(
    item: any,
    strategy: any,
    order: OrderModel
  ): Promise<OrderItemPricingDto> {
    const costPrice = item.costPriceAtSale || 0;
    const unitPrice = item.unitPrice || 0;
    const quantity = item.quantity || 1;

    // Lucro bruto por item (antes de comissões)
    const grossProfit = (unitPrice - costPrice) * quantity;
    const grossProfitPercent =
      unitPrice > 0 ? ((unitPrice - costPrice) / unitPrice) * 100 : 0;

    // Obter taxa de comissão do strategy
    const commissionRate = await strategy.getCommissionRate(item);
    const commissionAmount = (unitPrice * quantity * commissionRate) / 100;

    // Obter taxa de imposto do strategy
    const taxRate = await strategy.getTaxRate(item);
    const taxAmount = (unitPrice * quantity * taxRate) / 100;

    // Calcular frete por item (rateio)
    const shippingAllocationType = strategy.getShippingAllocationType();
    let freightAmount = 0;

    if (shippingAllocationType === 'per_item') {
      // Divide frete igualmente entre items
      freightAmount = order.shippingAmount / Math.max(order.items.length, 1);
    } else if (shippingAllocationType === 'weighted') {
      // Aloca frete proporcionalmente ao preço do item
      const totalValue = order.items.reduce((sum, i) => sum + (i.unitPrice || 0) * i.quantity, 0);
      freightAmount = totalValue > 0
        ? (order.shippingAmount * (unitPrice * quantity)) / totalValue
        : 0;
    }
    // else: lumpsum = 0 (sem rateio de frete)

    // Lucro líquido
    const netProfit = grossProfit - commissionAmount - taxAmount - freightAmount;
    const netProfitPercent =
      unitPrice * quantity > 0
        ? (netProfit / (unitPrice * quantity)) * 100
        : 0;

    return {
      externalId: item.externalId,
      sku: item.sku,
      title: item.title,
      quantity,
      unitPrice,
      costPrice,
      grossProfit,
      profitMarginPercent: grossProfitPercent,
      commissionAmount,
      commissionRate,
      taxAmount,
      taxRate,
      freightAmount,
      netProfit,
      netMarginPercent: netProfitPercent,
    };
  }

  /**
   * Agrega cálculos por item para obter totais da order
   */
  private calculateTotals(
    itemPricings: OrderItemPricingDto[],
    order: OrderModel
  ): OrderPricingTotalsDto {
    let grossRevenue = 0;
    let totalCostOfGoods = 0;
    let totalCommission = 0;
    let totalTaxes = 0;
    let totalFreight = 0;
    let totalGrossProfit = 0;
    let totalNetProfit = 0;

    for (const item of itemPricings) {
      const revenue = item.unitPrice * item.quantity;
      const costGoods = item.costPrice * item.quantity;

      grossRevenue += revenue;
      totalCostOfGoods += costGoods;
      totalCommission += item.commissionAmount;
      totalTaxes += item.taxAmount;
      totalFreight += item.freightAmount;
      totalGrossProfit += item.grossProfit;
      totalNetProfit += item.netProfit;
    }

    // Comissões já estão em order.payment.marketplaceFee, mas recalculamos para validação
    const avgCostPrice =
      itemPricings.reduce((sum, i) => sum + i.costPrice * i.quantity, 0) /
      Math.max(itemPricings.reduce((sum, i) => sum + i.quantity, 0), 1);

    const avgSellingPrice = itemPricings.length > 0
      ? itemPricings.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0) /
        Math.max(itemPricings.reduce((sum, i) => sum + i.quantity, 0), 1)
      : 0;

    const profitMarginPercent =
      grossRevenue > 0 ? (totalNetProfit / grossRevenue) * 100 : 0;

    return {
      grossRevenue,
      totalCostOfGoods,
      totalCommission,
      totalTaxes,
      totalFreight,
      totalOtherCosts: 0, // Cupons, descontos adicionais (não implementado por enquanto)
      totalGrossProfit,
      totalNetProfit,
      avgCostPrice,
      avgSellingPrice,
      profitMarginPercent,
    };
  }
}

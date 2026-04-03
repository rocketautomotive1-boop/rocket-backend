import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPricingCalculatorStrategy } from './pricing-calculator.strategy';
import { OrderItemSnapshot } from '../schemas/order.schema';

/**
 * Calculador genérico com rates configuráveis via .env
 * Usado como fallback para marketplaces não implementados
 */
@Injectable()
export class GenericPricingCalculator implements IPricingCalculatorStrategy {
  private defaultCommissionRate: number;
  private defaultTaxRate: number;
  private defaultShippingAllocationType: 'per_item' | 'lumpsum' | 'weighted';

  constructor(private configService: ConfigService) {
    // Default rates se não configurado
    this.defaultCommissionRate = parseFloat(
      this.configService.get('PRICING_DEFAULT_COMMISSION_RATE', '5.0')
    );
    this.defaultTaxRate = parseFloat(
      this.configService.get('PRICING_DEFAULT_TAX_RATE', '0.0')
    );
    this.defaultShippingAllocationType =
      (this.configService.get('PRICING_DEFAULT_SHIPPING_ALLOCATION', 'per_item') as any) ||
      'per_item';
  }

  async getCommissionRate(item: OrderItemSnapshot, category?: string): Promise<number> {
    return this.defaultCommissionRate;
  }

  async getTaxRate(item: OrderItemSnapshot): Promise<number> {
    return this.defaultTaxRate;
  }

  getShippingAllocationType(): 'per_item' | 'lumpsum' | 'weighted' {
    return this.defaultShippingAllocationType;
  }

  getName(): string {
    return 'GENERIC';
  }
}

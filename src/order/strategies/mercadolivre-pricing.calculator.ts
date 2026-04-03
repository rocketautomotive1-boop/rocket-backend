import { Injectable } from '@nestjs/common';
import { IPricingCalculatorStrategy } from './pricing-calculator.strategy';
import { OrderItemSnapshot } from '../schemas/order.schema';

/**
 * Calculador específico para Mercado Livre
 * Extrai comissão do campo orderitem.sale_fee (já fornecido pelo webhook)
 * ou calcula baseado em categoria
 */
@Injectable()
export class MercadoLivrePricingCalculator implements IPricingCalculatorStrategy {
  /**
   * Para Mercado Livre, a comissão é fornecida pelo webhook no campo sale_fee
   * Se não estiver disponível, usa taxa padrão por categoria
   */
  async getCommissionRate(item: OrderItemSnapshot, category?: string): Promise<number> {
    // ML taxa padrão: varia entre 5% a 17% dependendo da categoria
    // Eletrônicos/Auto = 12.7%
    // Livros/Educação = 5%
    // Moda/Beleza = 13.5%
    // Etc.
    //
    // Como o webhook já fornece o sale_fee em valor absoluto,
    // aqui retornamos uma taxa estimada por categoria como fallback
    // (se o sale_fee não foi capturado no item)

    if (!category) {
      return 12.7; // Taxa média padrão ML
    }

    // Mapa simplificado de categorias ML
    const categoryRates: Record<string, number> = {
      ELETRONICOS: 12.7,
      AUTOPARTES: 12.7,
      LIVROS: 5.0,
      EDUCACAO: 5.0,
      MODA: 13.5,
      BELEZA: 13.5,
      ESPORTES: 12.7,
      MOVEIS: 13.5,
    };

    return categoryRates[category.toUpperCase()] || 12.7;
  }

  /**
   * Mercado Livre não retém impostos directamente
   * Impostos (ICMS, PIS, COFINS) são responsabilidade do vendedor
   * Retorna 0 aqui pois os impostos já devem estar refletidos no costPrice
   */
  async getTaxRate(item: OrderItemSnapshot): Promise<number> {
    return 0; // ML não retém impostos do seller (seller é responsável)
  }

  /**
   * Mercado Livre aloca frete por item (divisão igual entre quantidade de itens)
   */
  getShippingAllocationType(): 'per_item' | 'lumpsum' | 'weighted' {
    return 'per_item';
  }

  getName(): string {
    return 'MERCADOLIVRE';
  }
}

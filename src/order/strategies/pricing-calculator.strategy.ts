import { OrderItemSnapshot } from '../schemas/order.schema';

export interface IPricingCalculatorStrategy {
  /**
   * Retorna a taxa de comissão do marketplace em percentual
   * @param item Item da order
   * @param category Categoria do produto (opcional, para ML por ex)
   * @returns Taxa em % (ex: 12.7 para 12.7%)
   */
  getCommissionRate(item: OrderItemSnapshot, category?: string): Promise<number>;

  /**
   * Retorna a taxa de imposto a debitar do valor da venda
   * (e.g., Amazon retém 25% em algumas categorias)
   * @param item Item da order
   * @returns Taxa em % (ex: 5.5 para 5.5%)
   */
  getTaxRate(item: OrderItemSnapshot): Promise<number>;

  /**
   * Define como alocar o custo de frete entre itens
   * @returns 'per_item' (divisão igual), 'lumpsum' (ignora frete), 'weighted' (por preço)
   */
  getShippingAllocationType(): 'per_item' | 'lumpsum' | 'weighted';

  /**
   * Retorna o nome da estratégia
   */
  getName(): string;
}

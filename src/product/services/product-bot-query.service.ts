import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel } from '../schemas/product.schema';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../stock/ports/stock-query.port';
import { PRICING_PORT, PricingPort } from '../../pricing/ports/pricing.port';
import { ProductInfoQueryPort } from '../../notifications/bot/ports/bot-query.ports';

interface ProductListRow {
  _id: Types.ObjectId | string;
  name: string;
  partNumber?: string;
  active?: boolean;
}

/**
 * Implementação do PRODUCT_INFO_QUERY_PORT (bot WhatsApp). Busca produto + estoque +
 * preço + última movimentação. Dona do ProductModel; estoque/preço/movimento via ports.
 */
@Injectable()
export class ProductBotQueryService implements ProductInfoQueryPort {
  private readonly logger = new Logger(ProductBotQueryService.name);
  private readonly MAX_RESULTS = 5;

  constructor(
    @InjectModel('ProductModel') private readonly productModel: Model<ProductModel>,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    @Inject(PRICING_PORT) private readonly pricing: PricingPort,
  ) {}

  async searchProduct(searchTerm: string): Promise<string> {
    try {
      const term = (searchTerm ?? '').trim();
      if (!term) {
        return '🔎 Informe um termo para buscar o produto. Ex.: *Roda Onix*';
      }

      const exact = await this.findExact(term);
      const products = exact ? [exact] : await this.findSuggestions(term);

      if (!products.length) {
        return `🔎 Nenhum produto encontrado para *${term}*.\nTente por nome, part number ou código de barras.`;
      }

      const lines = [`🔎 *Resultados para:* ${term}`];

      for (const product of products) {
        const productId = String((product as any)._id);
        const stock = (await this.stockQuery.getProductStock(productId)).onHand;
        const lastMovement = await this.getLastMovement(productId);
        const price = this.formatPrice(await this.pricing.getBasePrice(productId));
        const status = product.active === false ? 'inativo' : 'ativo';

        lines.push(
          '',
          `• *${product.name}*`,
          `  PN: ${product.partNumber ?? 'N/D'} · ${status}`,
          ...(price ? [`  Preço: ${price}`] : []),
          `  Estoque: ${stock}`,
          ...(lastMovement ? [`  Últ. mov.: ${lastMovement}`] : []),
        );
      }

      return lines.join('\n');
    } catch (err) {
      this.logger.error(`searchProduct failed: ${err.message}`);
      return `❌ Erro ao buscar produto: ${err.message}`;
    }
  }

  private async findExact(term: string): Promise<ProductListRow | null> {
    const exactRegex = new RegExp(`^${this.escapeRegex(term)}$`, 'i');
    return this.productModel
      .findOne({ $or: [{ partNumber: exactRegex }, { name: exactRegex }, { barcode: exactRegex }] })
      .lean()
      .exec() as any;
  }

  private async findSuggestions(term: string): Promise<ProductListRow[]> {
    const fuzzyRegex = new RegExp(this.escapeRegex(term), 'i');
    return (await this.productModel
      .find({ $or: [{ name: fuzzyRegex }, { partNumber: fuzzyRegex }, { barcode: fuzzyRegex }] })
      .limit(this.MAX_RESULTS)
      .lean()
      .exec()) as any;
  }

  private async getLastMovement(productId: string): Promise<string | null> {
    const movements = await this.stockQuery.listMovements(productId, 1);
    const movement = movements?.[0];
    if (!movement) return null;

    const when = movement.date
      ? new Date(movement.date).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : 'N/D';
    return `${movement.type} (${movement.quantity}) em ${when}`;
  }

  private formatPrice(raw: any): string | null {
    if (raw == null) return null;
    const parsed = Number(raw?.toString?.() ?? raw);
    if (!Number.isFinite(parsed)) return null;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parsed);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

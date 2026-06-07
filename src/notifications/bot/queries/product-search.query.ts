import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductModel } from '../../../product/schemas/product.schema';
import { StockMovementModel } from '../../../stock/schemas/stock-movement.schema';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../../stock/ports/stock-query.port';

interface ProductListRow {
  _id: Types.ObjectId | string;
  name: string;
  partNumber?: string;
  price?: any;
  active?: boolean;
}

@Injectable()
export class ProductSearchQuery {
  private readonly logger = new Logger(ProductSearchQuery.name);
  private readonly MAX_RESULTS = 5;

  constructor(
    @InjectModel('ProductModel') private readonly productModel: Model<ProductModel>,
    @InjectModel(StockMovementModel.name) private readonly stockMovementModel: Model<StockMovementModel>,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
  ) {}

  async execute(searchTerm: string): Promise<string> {
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
        const stock = (await this.stockQuery.getProductStock(String((product as any)._id))).onHand;
        const lastMovement = await this.getLastMovement(String((product as any)._id));
        const price = this.formatPrice(product.price);
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
      this.logger.error(`ProductSearchQuery failed: ${err.message}`);
      return `❌ Erro ao buscar produto: ${err.message}`;
    }
  }

  private async findExact(term: string): Promise<ProductListRow | null> {
    const escaped = this.escapeRegex(term);
    const exactRegex = new RegExp(`^${escaped}$`, 'i');

    return this.productModel
      .findOne({
        $or: [{ partNumber: exactRegex }, { name: exactRegex }, { barcode: exactRegex }],
      })
      .lean()
      .exec() as any;
  }

  private async findSuggestions(term: string): Promise<ProductListRow[]> {
    const fuzzyRegex = new RegExp(this.escapeRegex(term), 'i');
    return (await this.productModel
      .find({
        $or: [{ name: fuzzyRegex }, { partNumber: fuzzyRegex }, { barcode: fuzzyRegex }],
      })
      .limit(this.MAX_RESULTS)
      .lean()
      .exec()) as any;
  }

  private async getLastMovement(productId: string): Promise<string | null> {
    const matchProductId = Types.ObjectId.isValid(productId) ? new Types.ObjectId(productId) : productId;
    const movement = await this.stockMovementModel
      .findOne({ productId: matchProductId } as any)
      .sort({ date: -1 })
      .lean()
      .exec();

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

    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(parsed);
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

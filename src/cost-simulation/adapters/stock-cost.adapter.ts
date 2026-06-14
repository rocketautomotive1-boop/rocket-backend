import { Injectable, Logger } from '@nestjs/common';
import { StockCostPort } from '../ports';
import { ProductService } from '../../product/product.service';

/**
 * Adapter de custo unitário. Estratégia em camadas, isolada do service:
 *  1) StockService (quando existir no checkout) — injeção opcional, sem acoplar.
 *  2) ProductService.findOne(productId).costPrice / avgCost — fallback atual.
 *  3) 0 — caller marca a linha 'cost' como estimativa.
 *
 * Quando o StockModule for incorporado, injetar o StockService aqui (preferir sobre
 * ProductService). A porta StockCostPort não muda — service/engine ficam intocados.
 */
@Injectable()
export class StockCostAdapter implements StockCostPort {
  private readonly logger = new Logger(StockCostAdapter.name);

  constructor(private readonly productService: ProductService) {}

  async getUnitCost(productId: string): Promise<number> {
    try {
      const p: any = await this.productService.findOne(productId, { lean: true });
      const cost = Number(p?.avgCost ?? p?.costPrice ?? p?.cost ?? 0);
      return Number.isFinite(cost) ? cost : 0;
    } catch (e: any) {
      this.logger.warn(`Custo do produto indisponível (${productId}): ${e.message}`);
      return 0;
    }
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { ProductResolverPort, ResolveItemInput } from '../../order/ports/product-resolver.port';
import { ProductMatcherService } from '../services/product-matcher.service';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../stock/ports/stock-query.port';

@Injectable()
export class ProductResolverProvider implements ProductResolverPort {
  constructor(
    private readonly matcher: ProductMatcherService,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
  ) {}

  async resolveProduct(
    externalItemId: string,
    sku: string,
    marketplaceId?: string,
    title?: string,
  ): Promise<string | null> {
    return this.matcher.resolveProduct(externalItemId, sku, marketplaceId, title);
  }

  async resolveProducts(
    items: ResolveItemInput[],
    marketplaceId: string,
  ): Promise<Map<number, string | null>> {
    return this.matcher.resolveProducts(items, marketplaceId);
  }

  async getCostPrices(productIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!productIds.length) return map;
    // Cost now lives on the stock lot — read weighted-average lot cost via the port.
    for (const id of productIds) {
      map.set(id, await this.stockQuery.getProductCost(id));
    }
    return map;
  }
}

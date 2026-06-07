import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProductResolverPort, ResolveItemInput } from '../../order/ports/product-resolver.port';
import { ProductMatcherService } from '../services/product-matcher.service';
import { ProductModel } from '../schemas/product.schema';

@Injectable()
export class ProductResolverProvider implements ProductResolverPort {
  constructor(
    private readonly matcher: ProductMatcherService,
    @InjectModel(ProductModel.name) private readonly productModel: Model<ProductModel>,
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
    const products = await this.productModel
      .find({ _id: { $in: productIds } } as any)
      .select('_id costPrice')
      .lean()
      .exec();
    for (const p of products) {
      map.set(String((p as any)._id), Number((p as any).costPrice ?? 0));
    }
    return map;
  }
}

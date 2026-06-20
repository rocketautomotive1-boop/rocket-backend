import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { TikTokShopHttpClient } from './tiktok-shop-http-client';
import { HttpAuthContext } from '../shared/marketplace-http-client';
import { ProductDocument } from '../../../product/product-types';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ProductRepository } from '../../../product/product.repository';
import { STOCK_QUERY_PORT, StockQueryPort } from '../../../stock/ports/stock-query.port';

@Injectable()
export class TikTokShopProductAdapter implements IMarketplaceProductAdapter, OnModuleInit {
  private readonly logger = new Logger(TikTokShopProductAdapter.name);
  readonly name = 'TikTok Shop';

  constructor(
    @Inject(forwardRef(() => MarketplaceAdapterRegistry))
    private readonly registry: MarketplaceAdapterRegistry,
    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private readonly descriptionService: MarketplaceDescriptionService,
    private readonly productRepository: ProductRepository,
    @Inject(STOCK_QUERY_PORT) private readonly stockQuery: StockQueryPort,
    private readonly http: TikTokShopHttpClient,
  ) {}

  onModuleInit() {
    this.registry.registerProductAdapter(this.name, this);
    this.logger.log('TikTokShopProductAdapter registered');
  }

  async publishProduct(
    product: ProductDocument,
    marketplace: MarketplaceDocument,
    externalId?: string,
  ): Promise<{
    success: boolean;
    externalId?: string;
    skipped?: boolean;
    error?: string;
    result?: any;
    requestPayload?: any;
    responsePayload?: any;
    action?: string;
    title?: string;
  }> {
    // Token/shopCipher e auth-retry vivem no TikTokShopHttpClient.
    const ctx: HttpAuthContext = {
      context: externalId ? 'updateProduct' : 'createProduct',
      accountId: (product as any).accountId,
    };
    try {
      if (externalId) {
        return await this.updateProduct(product, marketplace, externalId, ctx);
      } else {
        return await this.createProduct(product, marketplace, ctx);
      }
    } catch (error: any) {
      const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      this.logger.error(`Erro ao publicar produto no TikTok Shop: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        action: externalId ? 'UPDATE' : 'CREATE',
        title: (product as any).name || '',
      };
    }
  }

  private async createProduct(
    product: ProductDocument,
    marketplace: MarketplaceDocument,
    ctx: HttpAuthContext,
  ): Promise<any> {
    // 1. Upload images
    const imageUris = await this.uploadProductImages(product, ctx);

    // 2. Generate description
    let description = '';
    try {
      description = await this.descriptionService.generateDescription(
        product,
        marketplace.name || 'TikTok Shop',
      );
    } catch {
      description = (product as any).description || (product as any).name || '';
    }

    // 3. Build payload
    const payload = await this.buildCreatePayload(product, description, imageUris);

    // 4. Send to TikTok Shop
    this.logger.log(`[TikTok Shop] Creating product: ${(product as any).name}`);
    const data = await this.http.post('/product/202309/products', { ...ctx, context: 'createProduct' }, payload);

    if (data?.code !== 0) {
      throw new Error(`TikTok Shop API Error: ${data?.message || JSON.stringify(data)}`);
    }

    const productId = data?.data?.product_id;

    // 5. Activate the product
    if (productId) {
      await this.activateProduct(productId, ctx);
    }

    return {
      success: true,
      externalId: productId,
      action: 'CREATE',
      title: (product as any).name || '',
      requestPayload: payload,
      responsePayload: data,
    };
  }

  private async updateProduct(
    product: ProductDocument,
    marketplace: MarketplaceDocument,
    externalId: string,
    ctx: HttpAuthContext,
  ): Promise<any> {
    // 1. Upload new images if any
    const imageUris = await this.uploadProductImages(product, ctx);

    // 2. Generate description
    let description = '';
    try {
      description = await this.descriptionService.generateDescription(
        product,
        marketplace.name || 'TikTok Shop',
      );
    } catch {
      description = (product as any).description || (product as any).name || '';
    }

    // 3. Build update payload
    const payload = this.buildUpdatePayload(product, description, imageUris);

    // 4. Send update
    this.logger.log(`[TikTok Shop] Updating product ${externalId}`);
    const data = await this.http.request({
      method: 'PUT',
      path: `/product/202309/products/${externalId}`,
      body: payload,
    }, { ...ctx, context: 'updateProduct' }).then(r => r.data);

    if (data?.code !== 0) {
      throw new Error(`TikTok Shop Update Error: ${data?.message || JSON.stringify(data)}`);
    }

    return {
      success: true,
      externalId,
      action: 'UPDATE',
      title: (product as any).name || '',
      requestPayload: payload,
      responsePayload: data,
    };
  }

  async unpublishProduct(externalId: string, marketplace: MarketplaceDocument): Promise<any> {
    try {
      const data = await this.http.post(
        '/product/202309/products/deactivate',
        { context: 'unpublishProduct' },
        { product_ids: [externalId] },
      );

      return {
        success: data?.code === 0,
        error: data?.code !== 0 ? data?.message : undefined,
        result: data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async activateProduct(productId: string, ctx: HttpAuthContext): Promise<void> {
    try {
      await this.http.post('/product/202309/products/activate', { ...ctx, context: 'activateProduct' }, {
        product_ids: [productId],
      });
      this.logger.log(`[TikTok Shop] Product ${productId} activated`);
    } catch (error: any) {
      this.logger.warn(`[TikTok Shop] Could not activate product ${productId}: ${error.message}`);
    }
  }

  async uploadImage(imageUrl: string, ctx: HttpAuthContext): Promise<string | null> {
    try {
      const data = await this.http.request({
        method: 'POST',
        path: '/product/202309/images/upload',
        body: { image_url: imageUrl },
        axiosConfig: { timeout: 15000 },
      }, { ...ctx, context: 'uploadImage' }).then(r => r.data);

      if (data?.code === 0 && data?.data?.uri) {
        return data.data.uri;
      }

      this.logger.warn(`[TikTok Shop] Image upload failed: ${JSON.stringify(data)}`);
      return null;
    } catch (error: any) {
      this.logger.warn(`[TikTok Shop] Image upload error for ${imageUrl}: ${error.message}`);
      return null;
    }
  }

  private async uploadProductImages(product: ProductDocument, ctx: HttpAuthContext): Promise<string[]> {
    const images = (product as any).images || [];
    const uniqueImages = [...new Set(images as string[])].slice(0, 9);
    const uris: string[] = [];

    for (const img of uniqueImages) {
      if (!img) continue;
      const uri = await this.uploadImage(img, ctx);
      if (uri) uris.push(uri);
    }

    return uris;
  }

  private async buildCreatePayload(product: ProductDocument, description: string, imageUris: string[]): Promise<any> {
    const p = product as any;
    const price = p.price || 0;
    const productId = (p._id || p.id)?.toString();
    const stock = Math.max(0, (await this.stockQuery.getProductStock(productId)).onHand);

    return {
      title: (p.name || '').slice(0, 255),
      description: description || p.description || '',
      category_id: this.resolveCategoryId(p),
      brand_id: p.brand?.tiktokBrandId || undefined,
      main_images: imageUris.map((uri) => ({ uri })),
      skus: [
        {
          seller_sku: p.sku || p.partNumber || String(p._id),
          price: {
            amount: String(Math.round(price * 100)),
            currency: 'BRL',
          },
          inventory: [
            {
              warehouse_id: process.env.TIKTOK_SHOP_WAREHOUSE_ID || '0',
              quantity: stock,
            },
          ],
        },
      ],
      package_dimensions: {
        length: String(p.dimensions?.length || p.packageLength || 20),
        width: String(p.dimensions?.width || p.packageWidth || 20),
        height: String(p.dimensions?.height || p.packageHeight || 10),
        weight: String(p.dimensions?.weight || p.weight || 0.5),
        unit: 'METRIC',
      },
      is_cod_allowed: false,
    };
  }

  private buildUpdatePayload(product: ProductDocument, description: string, imageUris: string[]): any {
    const p = product as any;

    const payload: any = {
      title: (p.name || '').slice(0, 255),
      description: description || p.description || '',
    };

    if (imageUris.length > 0) {
      payload.main_images = imageUris.map((uri) => ({ uri }));
    }

    if (p.dimensions || p.weight) {
      payload.package_dimensions = {
        length: String(p.dimensions?.length || p.packageLength || 20),
        width: String(p.dimensions?.width || p.packageWidth || 20),
        height: String(p.dimensions?.height || p.packageHeight || 10),
        weight: String(p.dimensions?.weight || p.weight || 0.5),
        unit: 'METRIC',
      };
    }

    return payload;
  }

  private resolveCategoryId(product: any): string {
    // Check marketplace mappings
    const mapping = product.category?.marketplaceMappings?.find(
      (m: any) => m.marketplaceName === 'TikTok Shop' || m.marketplaceTag === 'tiktokshop',
    );
    if (mapping?.externalId) return String(mapping.externalId);

    // Fallback default category
    return process.env.TIKTOK_SHOP_DEFAULT_CATEGORY_ID || '0';
  }
}

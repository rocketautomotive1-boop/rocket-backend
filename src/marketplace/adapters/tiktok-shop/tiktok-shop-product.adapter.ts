import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { TikTokShopAuthAdapter } from './tiktok-shop-auth.adapter';
import { getTikTokShopBaseUrl, buildSignedParams, buildHeaders } from './tiktok-shop-utils';
import { ProductDocument } from '../../../product/product-types';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ProductRepository } from '../../../product/product.repository';

@Injectable()
export class TikTokShopProductAdapter implements IMarketplaceProductAdapter, OnModuleInit {
  private readonly logger = new Logger(TikTokShopProductAdapter.name);
  private readonly baseUrl = getTikTokShopBaseUrl();
  readonly name = 'TikTok Shop';

  constructor(
    @Inject(forwardRef(() => MarketplaceAdapterRegistry))
    private readonly registry: MarketplaceAdapterRegistry,
    @Inject(forwardRef(() => TikTokShopAuthAdapter))
    private readonly authAdapter: TikTokShopAuthAdapter,
    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private readonly descriptionService: MarketplaceDescriptionService,
    private readonly productRepository: ProductRepository,
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
    try {
      const token = await this.authAdapter.getValidToken('TikTok Shop');
      const shopCipher = token.additionalData?.shopCipher;

      if (externalId) {
        return await this.updateProduct(product, marketplace, externalId, token, shopCipher);
      } else {
        return await this.createProduct(product, marketplace, token, shopCipher);
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
    token: any,
    shopCipher?: string,
  ): Promise<any> {
    // 1. Upload images
    const imageUris = await this.uploadProductImages(product, token, shopCipher);

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
    const path = '/product/202309/products';
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyStr = JSON.stringify(payload);
    const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

    this.logger.log(`[TikTok Shop] Creating product: ${(product as any).name}`);

    const response = await axios.post(`${this.baseUrl}${path}`, payload, {
      headers: buildHeaders(token.accessToken),
      params,
    });

    if (response.data?.code !== 0) {
      throw new Error(`TikTok Shop API Error: ${response.data?.message || JSON.stringify(response.data)}`);
    }

    const productId = response.data?.data?.product_id;

    // 5. Activate the product
    if (productId) {
      await this.activateProduct(productId, token, shopCipher);
    }

    return {
      success: true,
      externalId: productId,
      action: 'CREATE',
      title: (product as any).name || '',
      requestPayload: payload,
      responsePayload: response.data,
    };
  }

  private async updateProduct(
    product: ProductDocument,
    marketplace: MarketplaceDocument,
    externalId: string,
    token: any,
    shopCipher?: string,
  ): Promise<any> {
    // 1. Upload new images if any
    const imageUris = await this.uploadProductImages(product, token, shopCipher);

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
    const path = `/product/202309/products/${externalId}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyStr = JSON.stringify(payload);
    const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

    this.logger.log(`[TikTok Shop] Updating product ${externalId}`);

    const response = await axios.put(`${this.baseUrl}${path}`, payload, {
      headers: buildHeaders(token.accessToken),
      params,
    });

    if (response.data?.code !== 0) {
      throw new Error(`TikTok Shop Update Error: ${response.data?.message || JSON.stringify(response.data)}`);
    }

    return {
      success: true,
      externalId,
      action: 'UPDATE',
      title: (product as any).name || '',
      requestPayload: payload,
      responsePayload: response.data,
    };
  }

  async unpublishProduct(externalId: string, marketplace: MarketplaceDocument): Promise<any> {
    try {
      const token = await this.authAdapter.getValidToken('TikTok Shop');
      const shopCipher = token.additionalData?.shopCipher;

      const path = '/product/202309/products/deactivate';
      const timestamp = Math.floor(Date.now() / 1000);
      const body = { product_ids: [externalId] };
      const bodyStr = JSON.stringify(body);
      const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

      const response = await axios.post(`${this.baseUrl}${path}`, body, {
        headers: buildHeaders(token.accessToken),
        params,
      });

      return {
        success: response.data?.code === 0,
        error: response.data?.code !== 0 ? response.data?.message : undefined,
        result: response.data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async activateProduct(productId: string, token: any, shopCipher?: string): Promise<void> {
    try {
      const path = '/product/202309/products/activate';
      const timestamp = Math.floor(Date.now() / 1000);
      const body = { product_ids: [productId] };
      const bodyStr = JSON.stringify(body);
      const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

      await axios.post(`${this.baseUrl}${path}`, body, {
        headers: buildHeaders(token.accessToken),
        params,
      });

      this.logger.log(`[TikTok Shop] Product ${productId} activated`);
    } catch (error: any) {
      this.logger.warn(`[TikTok Shop] Could not activate product ${productId}: ${error.message}`);
    }
  }

  async uploadImage(imageUrl: string, token: any, shopCipher?: string): Promise<string | null> {
    const path = '/product/202309/images/upload';
    const timestamp = Math.floor(Date.now() / 1000);
    const body = { image_url: imageUrl };
    const bodyStr = JSON.stringify(body);
    const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

    try {
      const response = await axios.post(`${this.baseUrl}${path}`, body, {
        headers: buildHeaders(token.accessToken),
        params,
        timeout: 15000,
      });

      if (response.data?.code === 0 && response.data?.data?.uri) {
        return response.data.data.uri;
      }

      this.logger.warn(`[TikTok Shop] Image upload failed: ${JSON.stringify(response.data)}`);
      return null;
    } catch (error: any) {
      this.logger.warn(`[TikTok Shop] Image upload error for ${imageUrl}: ${error.message}`);
      return null;
    }
  }

  private async uploadProductImages(product: ProductDocument, token: any, shopCipher?: string): Promise<string[]> {
    const images = (product as any).images || [];
    const uniqueImages = [...new Set(images as string[])].slice(0, 9);
    const uris: string[] = [];

    for (const img of uniqueImages) {
      if (!img) continue;
      const uri = await this.uploadImage(img, token, shopCipher);
      if (uri) uris.push(uri);
    }

    return uris;
  }

  private async buildCreatePayload(product: ProductDocument, description: string, imageUris: string[]): Promise<any> {
    const p = product as any;
    const price = p.price || 0;
    const productId = (p._id || p.id)?.toString();
    const stock = Math.max(0, await this.productRepository.calculateStock(productId));

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

import { Injectable, HttpException, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ProductDocument } from '../../../product/product-types';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { ListingService } from '../../../listing/listing.service';
import { ShopeeHttpClient } from './shopee-http-client';
import { HttpAuthContext } from '../shared/marketplace-http-client';

@Injectable()
export class ShopeeProductAdapter implements IMarketplaceProductAdapter, OnModuleInit {
  private name = 'Shopee';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly descriptionService: MarketplaceDescriptionService,
    private readonly listingService: ListingService,
    private readonly http: ShopeeHttpClient,
  ) { }

  onModuleInit() {
    this.registry.registerProductAdapter(this.name, this);
  }

  /** Contexto de auth (conta default Shopee; shopId resolvido pelo HttpClient). */
  private ctx(context: string): HttpAuthContext {
    return { context };
  }

  async getListings(params: any): Promise<any[]> {
    const mId = params.marketplaceId;
    const items = await this.getItemList({
      limit: params?.limit || 50,
      offset: params?.offset || 0,
      status: params?.status ? (params.status === 'active' ? 'NORMAL' : undefined) : undefined
    });

    return items.map((i: any) => ({
      id: String(i.item_id),
      title: i.item_name,
      price: i.price_info?.[0]?.original_price || 0,
      available_quantity: i.stock_info?.[0]?.current_stock || 0,
      sold_quantity: i.sales_info?.sold_count || 0,
      status: i.item_status,
      thumbnail: i.image?.image_url_list?.[0] || '',
      permalink: '',
      date_created: new Date(i.create_time * 1000).toISOString(),
      marketplace: {
        id: mId,
        name: this.name,
        type: 'shopee',
        icon: 'shopping'
      }
    }));
  }

  async publishProduct(product: ProductDocument, marketplace: MarketplaceDocument, externalId?: string): Promise<any> {
    try {
      const allListings = await this.listingService.findByProduct(product._id);

      const titles = allListings.filter(t => String(t.marketplaceId) === String(marketplace.id));

      if (titles.length === 0) {
        titles.push({ title: product.name } as any);
      }

      const results = [];
      for (const title of titles) {
        try {
          let result;
          let finalExternalId = title.externalId;
          if (!finalExternalId && titles.length === 1 && externalId) {
            finalExternalId = externalId;
          }

          const productPayload = { ...product, name: title.title };

          if (finalExternalId) {
            result = await this.updateProduct(finalExternalId, productPayload, marketplace);
          } else {
            result = await this.createProduct(productPayload, marketplace);
          }

          if (result.success && !finalExternalId) {
            result.externalId = result.externalId || result.item_id;
          }

          results.push({ ...result, title: title.title });
        } catch (e: any) {
          results.push({ success: false, error: e.message, title: title.title });
        }
      }

      const success = results.some(r => r.success);
      const firstSuccess = results.find(r => r.success);

      return {
        success,
        externalId: firstSuccess?.externalId,
        results,
        result: results,
        error: success ? undefined : results[0]?.error,
        responsePayload: results.length === 1 ? results[0].responsePayload : results,
        requestPayload: results.length === 1 ? results[0].requestPayload : results.map(r => r.requestPayload)
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getItemList(params: { offset?: number; limit?: number; status?: string }): Promise<any> {
    const payload = await this.http.get<any>('/product/get_item_list', this.ctx('getItemList'), {
      offset: params.offset || 0,
      page_size: params.limit || 20,
      item_status: params.status || 'NORMAL',
    });

    if (payload?.error) {
      throw new Error(`Shopee Error: ${payload.message || payload.error}`);
    }

    const itemList = payload?.response?.item_list || [];

    if (itemList.length > 0) {
      const itemIds = itemList.map((i: any) => i.item_id);
      return await this.getItemBaseInfo(itemIds);
    }

    return [];
  }

  async getItemBaseInfo(itemIds: number[]): Promise<any[]> {
    const payload = await this.http.get<any>('/product/get_item_base_info', this.ctx('getItemBaseInfo'), {
      item_id_list: itemIds,
    });
    return payload?.response?.item_list || [];
  }

  /** Lista os canais de logística da loja Shopee (payload bruto da API). */
  async getLogisticsChannels(): Promise<any> {
    return this.http.get<any>('/logistics/get_channel_list', this.ctx('getLogisticsChannels'));
  }

  private async uploadImage(imageUrl: string): Promise<any> {
    const path = '/media_space/upload_image';
    try {
      let response: any;
      try {
        const FormData = require('form-data');
        const fileResp = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(fileResp.data);
        const fileNameGuess = (imageUrl.split('/').pop() || `image_${Date.now()}`).split('?')[0];
        const ct = /\.png$/i.test(fileNameGuess) ? 'image/png' : 'image/jpeg';
        const form = new FormData();
        form.append('image', buffer, { filename: fileNameGuess, contentType: ct, knownLength: buffer.length });

        response = await this.http.request<any>(
          {
            method: 'POST',
            path,
            body: form,
            headers: form.getHeaders(),
            axiosConfig: { timeout: 30000 },
          },
          this.ctx('uploadImage'),
        );
      } catch (modErr) {
        response = await this.http.request<any>(
          { method: 'POST', path, body: { image_url: imageUrl }, axiosConfig: { timeout: 30000 } },
          this.ctx('uploadImage'),
        );
      }
      const imageId = this.extractImageId(response.data);
      const imageUrlRet = response.data?.response?.image_url || response.data?.image_url || response.data?.url || imageUrl;
      return { id: imageId, url: imageUrlRet };
    } catch (error: any) {
      if (error?.response?.data) throw new Error(JSON.stringify(error.response.data));
      throw new Error(`Falha no upload de imagem na Shopee: ${error.message}`);
    }
  }

  private async getImageIdsByUrl(urls: string[]): Promise<string[]> {
    if (!urls || urls.length === 0) return [];
    const path = '/media_space/get_image';
    try {
      const data = await this.http.post<any>(path, this.ctx('getImageIdsByUrl'), { image_url_list: urls });
      const list = data?.response?.image_id_list
        || data?.image_id_list
        || (data?.response?.images || []).map((x: any) => x.image_id)
        || (data?.images || []).map((x: any) => x.image_id);
      return Array.isArray(list) ? list.map((id: any) => String(id)) : [];
    } catch (error: any) {
      return [];
    }
  }

  private extractImageId(data: any): string | undefined {
    if (!data) return undefined;
    const candidates: any[] = [];
    candidates.push(data?.response?.image_id);
    candidates.push(data?.image_id);
    candidates.push(data?.id);
    candidates.push(data?.response?.image?.image_id);
    candidates.push(data?.image?.image_id);
    candidates.push(data?.response?.image_info?.image_id);
    candidates.push(data?.image_info?.image_id);
    const lists = [
      data?.response?.images,
      data?.images,
      data?.response?.image_list,
      data?.image_list,
    ].filter(Boolean);
    for (const list of lists as any[]) {
      if (Array.isArray(list) && list.length) {
        const first = list[0];
        candidates.push(first?.image_id);
        candidates.push(first?.id);
      }
    }
    for (const c of candidates) {
      if (c !== undefined && c !== null && String(c).length > 0) return String(c);
    }
    try {
      const stack: any[] = [data];
      const seen = new Set<any>();
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        for (const [k, v] of Object.entries(node)) {
          if (/image_?id/i.test(k) && v !== undefined && v !== null) return String(v);
          if (typeof v === 'object') stack.push(v);
        }
      }
    } catch { }
    return undefined;
  }

  private async prepareImages(images: string[]): Promise<string[]> {
    const result: string[] = [];
    const uniqueImages = [...new Set(images || [])];
    for (const img of uniqueImages.slice(0, 9)) {
      try {
        const cleaned = typeof img === 'string' ? String(img).trim().replace(/^\s*[`'\"]|[`'\"]\s*$/g, '') : img;
        if (typeof cleaned === 'string' && /^https?:\/\//.test(cleaned)) {
          const uploaded = await this.uploadImage(cleaned);
          if (uploaded?.id !== undefined && uploaded?.id !== null) {
            result.push(String(uploaded.id));
            continue;
          }
          const ids = await this.getImageIdsByUrl([uploaded?.url || cleaned]);
          if (ids.length > 0) {
            result.push(ids[0]);
            continue;
          }
          continue;
        }
        const maybeId = cleaned as any;
        if (maybeId !== undefined && maybeId !== null) {
          result.push(String(maybeId));
        }
      } catch (err: any) {
        // Auth errors are handled by ShopeeHttpClient's retry; other errors skip the image.
        continue;
      }
    }
    return result;
  }

  async createProduct(product: any, marketplace?: any): Promise<any> {
    let shopeeProduct: any;
    try {
      const validation = await this.validateProduct(product);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Dados inválidos para criação na Shopee: ${validation.missingRequirements.join('; ')}`,
          missingRequirements: validation.missingRequirements
        };
      }

      shopeeProduct = await this.transformProductToShopee(product, marketplace);

      const path = '/product/add_item';

      let usedImageIds: string[] = [];
      if (Array.isArray(shopeeProduct.images) && shopeeProduct.images.length) {
        const prepared = await this.prepareImages(shopeeProduct.images);
        usedImageIds = prepared;
        shopeeProduct.image = prepared.length > 0 ? { image_id_list: prepared } : undefined;
      }

      const imageField = shopeeProduct.image ? { image: shopeeProduct.image } : {};
      const finalPayload = { ...shopeeProduct, ...imageField };

      const payload = await this.http.post<any>(path, this.ctx('createProduct'), finalPayload);

      const itemId = payload.response?.item_id || payload.item_id || payload.data?.item_id;

      if (!itemId) {
        return {
          success: false,
          error: payload.message || payload.error || 'Falha ao obter item_id da Shopee',
          requestPayload: finalPayload,
          responsePayload: payload
        };
      }

      return {
        success: true,
        externalId: String(itemId),
        data: payload,
        requestPayload: finalPayload,
        responsePayload: payload
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        requestPayload: shopeeProduct || null,
        responsePayload: error.response?.data || null
      };
    }
  }

  async updateProductPrice(externalId: string, price: number): Promise<any> {
    const path = '/product/update_price';
    return this.http.post<any>(path, this.ctx('updateProductPrice'), {
      item_id: parseInt(externalId),
      price_list: [{ original_price: price }],
    });
  }

  async updateProductStock(externalId: string, stock: number): Promise<any> {
    const path = '/product/update_stock';
    return this.http.post<any>(path, this.ctx('updateProductStock'), {
      item_id: parseInt(externalId),
      stock_list: [{ seller_stock: [{ stock }] }],
    });
  }

  async updateProduct(externalId: string, product: any, marketplace?: any): Promise<any> {
    const validation = await this.validateProduct(product);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Dados inválidos para atualização na Shopee: ${validation.missingRequirements.join('; ')}`,
        missingRequirements: validation.missingRequirements
      };
    }

    const path = '/product/update_item';
    const shopeeProduct = await this.transformProductToShopee(product, marketplace);

    // Check for price and stock updates using transformed values which handle fallbacks correctly
    if (shopeeProduct.original_price !== undefined && shopeeProduct.original_price > 0) {
      try {
        await this.updateProductPrice(externalId, Number(shopeeProduct.original_price));
      } catch (e: any) {
        // Silent fail — price update is best-effort.
      }
    }

    const stockVal = shopeeProduct.stock ?? shopeeProduct.quantity;
    if (stockVal !== undefined) {
      try {
        await this.updateProductStock(externalId, Number(stockVal));
      } catch (e: any) {
        // Silent fail — stock update is best-effort.
      }
    }

    // Remove price and stock from generic update payload to avoid conflicts/redundancy
    delete shopeeProduct.original_price;
    delete shopeeProduct.stock;
    delete shopeeProduct.quantity;

    if (Array.isArray(shopeeProduct.images) && shopeeProduct.images.length) {
      const prepared = await this.prepareImages(shopeeProduct.images);
      shopeeProduct.image = prepared.length > 0 ? { image_id_list: prepared } : undefined;
      delete shopeeProduct.images;
    }

    const finalPayload = {
      ...shopeeProduct,
      item_id: parseInt(externalId),
    };

    const payload = await this.http.post<any>(path, this.ctx('updateProduct'), finalPayload);

    const itemId = payload.response?.item_id || payload.item_id || payload.data?.item_id;

    if (!itemId) {
      return {
        success: false,
        error: payload.message || payload.error || 'Falha na atualização Shopee',
        requestPayload: finalPayload,
        responsePayload: payload
      };
    }

    return {
      success: true,
      externalId: String(itemId || externalId),
      data: payload,
      requestPayload: finalPayload,
      responsePayload: payload
    };
  }

  async updateProductImages(externalId: string, images: any[]): Promise<any> {
    try {
      const path = '/product/update_item';

      let imagesPayload: any;
      if (Array.isArray(images) && images.length) {
        const first = images[0];
        const hasIds = typeof first === 'number' || typeof first === 'string' || first.image_id !== undefined || first.id !== undefined;
        if (hasIds) {
          const ids = images.map((img: any) => String(img.image_id ?? img.id ?? img));
          imagesPayload = { image_id_list: ids };
        } else if (first.url) {
          const imageUrlsRaw = images.map((img: any) => img.url);
          const prepared = await this.prepareImages(imageUrlsRaw);
          imagesPayload = prepared.length > 0 ? { image_id_list: prepared } : { image_url_list: imageUrlsRaw };
        }
      }

      const imageField: any = (() => {
        if (imagesPayload && typeof imagesPayload === 'object' && Array.isArray(imagesPayload.image_id_list)) {
          return { image: { image_id_list: imagesPayload.image_id_list } };
        }
        return {};
      })();

      const marketplaceData = await this.http.post<any>(path, this.ctx('updateProductImages'), {
        item_id: parseInt(externalId),
        ...imageField,
      });

      return {
        externalId,
        status: 'active',
        marketplaceData,
        used_image_ids: Array.isArray(imagesPayload?.image_id_list) ? imagesPayload.image_id_list : [],
      };
    } catch (error: any) {
      throw this.toHttpError(error, 'imagens');
    }
  }

  async updateProductTitle(externalId: string, title: string): Promise<any> {
    try {
      const path = '/product/update_item';
      const marketplaceData = await this.http.post<any>(path, this.ctx('updateProductTitle'), {
        item_id: parseInt(externalId),
        item_name: title,
        name: title,
      });

      return { externalId, status: 'active', marketplaceData };
    } catch (error: any) {
      throw this.toHttpError(error, 'título');
    }
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {
    try {
      const path = '/product/update_item';
      const marketplaceData = await this.http.post<any>(path, this.ctx('updateProductCategory'), {
        item_id: parseInt(externalId),
        category_id: parseInt(category.idOut),
      });

      return { externalId, status: 'active', marketplaceData };
    } catch (error: any) {
      throw this.toHttpError(error, 'categoria');
    }
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {
    try {
      const path = '/product/update_stock';
      // Shopee V2 Structure: stock_list with model_id: 0 for simple products
      const marketplaceData = await this.http.post<any>(path, this.ctx('updateProductInventory'), {
        item_id: parseInt(externalId),
        stock_list: [
          {
            model_id: 0,
            seller_stock: [{ stock: Number(inventory.quantity) }]
          }
        ],
      });

      return { externalId, status: 'active', marketplaceData };
    } catch (error: any) {
      throw this.toHttpError(error, 'estoque');
    }
  }

  private toHttpError(error: any, what: string): HttpException {
    if (error?.response?.status) {
      return new HttpException(error.response.data ?? { message: error.message }, error.response.status);
    }
    try {
      const parsed = JSON.parse(error.message);
      return new HttpException(parsed, 400);
    } catch { }
    return new HttpException({ message: `Falha na atualização de ${what} na Shopee: ${error.message}` }, 400);
  }

  private validateAndConvertPrice(price: any): number {
    if (price === undefined || price === null) return 0;
    if (typeof price === 'string') {
      const parsedPrice = parseFloat(price.replace(',', '.'));
      return isNaN(parsedPrice) ? 0 : parsedPrice;
    }
    return Number(price) || 0;
  }

  async validateProduct(product: any): Promise<{ isValid: boolean, missingRequirements: string[] }> {
    const missingRequirements = [];

    // Validar título
    const shopeeTitle = product.titles?.find((t: any) =>
      !t.marketplaceId || t.marketplace?.name === 'Shopee' || !t.marketplace
    );
    if (!shopeeTitle && !product.name) {
      missingRequirements.push('Título do produto');
    }

    // Validar imagens
    if (!product.productImages || !product.productImages.length) {
      missingRequirements.push('Imagens do produto (mínimo 1)');
    }

    // Validar preço (custo NUNCA é usado como preço de venda)
    const priceVal = product.price;
    if (!priceVal || Number(priceVal) <= 0) {
      missingRequirements.push('Preço do produto (maior que 0)');
    }

    const isValid = missingRequirements.length === 0;
    return { isValid, missingRequirements };
  }

  private async transformProductToShopee(product: any, marketplace?: any): Promise<any> {
    // STRICT MIRRORING: If product.name is set (which we assume is the forced title from publishProduct loop), use it directly.
    // Do not search titles again, as that reverts to the list instead of the specific title we want to publish.
    let nameRaw = product.name;

    if (!nameRaw) {
      const shopeeTitle = product.titles?.find((t: any) =>
        (t.marketplace && t.marketplace.name === 'Shopee') ||
        ((marketplace as any).mongoId && String(t.marketplaceId) === String((marketplace as any).mongoId))
      )?.title || product.titles?.[0]?.title;
      nameRaw = shopeeTitle || product.item_sku || product.partNumber || '';
    }

    const name = String(nameRaw).trim().slice(0, 120);

    // Check if category is object and has mappings (populated)
    const categoryObj = product.category as any;

    // 1. Prefer normalized externalId if it exists AND is numeric (Shopee requires number)
    let categoryId = undefined;
    if (categoryObj && categoryObj.externalId && /^\d+$/.test(String(categoryObj.externalId))) {
      categoryId = categoryObj.externalId;
    }

    // 2. Fallback to older mapping logic
    if (!categoryId) {
      const categoryMapping = categoryObj?.marketplaceMappings?.find((m: any) =>
        m.marketplace?.name === 'Shopee'
      );
      if (categoryMapping?.marketplaceCategory?.externalId && /^\d+$/.test(String(categoryMapping.marketplaceCategory.externalId))) {
        categoryId = categoryMapping.marketplaceCategory.externalId;
      }
    }

    // 3. Fallback to product.category_id (legacy)
    if (!categoryId && product.category_id && /^\d+$/.test(String(product.category_id))) {
      categoryId = product.category_id;
    }

    // 4. Final Default
    if (!categoryId) categoryId = 102284; // Outros cadastros

    const priceVal = product.price || product.inventory?.[0]?.priceSale; // never publish at cost
    const price = this.validateAndConvertPrice(priceVal);
    const originalPrice = price;
    const stock = Number(product.quantity ?? 0);

    // Shopee description needs to be descriptive but shortDescription is sometimes just a name
    // Use generated marketplaceDescription if available (from MarketplaceService)
    let description = product['marketplaceDescription'] || product.description || product.shortDescription || name;

    // Generate description using template service if initialized
    if (this.descriptionService && marketplace) {
      try {
        const templateDesc = await this.descriptionService.generateDescription(product, this.name);
        if (templateDesc) {
          description = templateDesc;
        }
      } catch (e) {
        // Template generation is best-effort; fall back to the computed description.
      }
    }

    // Ensure description is at least 20 chars (Shopee requirement)
    if (description.length < 20) {
      description = `${description} - Produto de alta qualidade. Enviamos para todo o Brasil. Garantia de procedência.`;
    }

    const dimension = {
      package_length: Number(product.dimensions?.length || product.length || 20),
      package_width: Number(product.dimensions?.width || product.width || 20),
      package_height: Number(product.dimensions?.height || product.height || 10),
    };

    const brandInput = product.brand;
    let brand: any = { brand_id: 0 };
    if (brandInput) {
      const brandName = brandInput.name || brandInput.brand_name || (typeof brandInput === 'string' ? brandInput : '');
      if (brandName) {
        brand = { brand_id: 0, original_brand_name: String(brandName) };
      }
    }

    const itemSku = String(product._id).slice(0, 100);
    const condition = 'NEW'; // Defaulting to NEW for Shopee integration

    let images: any = undefined;
    if (product.productImages && Array.isArray(product.productImages)) {
      images = product.productImages.map((img: any) => img.url);
    }

    const attributes = this.transformAttributes(product);

    // Forçar logistic_id 91003 (Padrão para muitas lojas Shopee no Brasil)
    const logistic_info = [{ logistic_id: 91003, enabled: true, is_free: false }];

    const tax_info = {
      ncm: product.ncm || '87089990',
      same_state_cfop: '5102',
      diff_state_cfop: '6108',
      csosn: '',
      origin: '0',
      cest: '0199900',
      measure_unit: 'UN'
    };

    return {
      name,
      item_name: name,
      category_id: categoryId ? parseInt(categoryId) : undefined,
      price,
      original_price: originalPrice,
      stock,
      seller_stock: [{ stock: parseInt(String(stock)) }],
      description,
      weight: Number(product.weight || 500) / 1000, // Shopee expects kg
      dimension,
      brand,
      item_sku: itemSku,
      condition,
      images,
      attributes,
      logistic_info,
      tax_info,
    };
  }

  private transformAttributes(product: any): any[] {
    const attributes: any[] = [];
    const sourceAttributes = product.attributes || product.attribute; // Support both Mongo (attributes) and legacy
    if (sourceAttributes && Array.isArray(sourceAttributes)) {
      sourceAttributes.forEach((attr: any) => {
        attributes.push({
          attribute_id: attr.id || attr.attribute_id, // Support both structures
          attribute_value_list: [{
            value_id: 0,
            original_value_name: attr.value || attr.original_value_name,
            value_unit: attr.unit || '',
          }],
        });
      });
    }
    return attributes;
  }
}

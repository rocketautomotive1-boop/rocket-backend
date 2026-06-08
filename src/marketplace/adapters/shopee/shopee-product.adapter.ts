import { Injectable, HttpException, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { ShopeeAuthAdapter } from './shopee-auth.adapter'
import { getShopeeBaseUrl, buildSignedParams, buildHeaders, getSignatureBaseString } from './shopee-utils'
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ProductDocument } from '../../../product/product-types';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { ListingService } from '../../../listing/listing.service'; // [NEW] Import

@Injectable()
export class ShopeeProductAdapter implements IMarketplaceProductAdapter, OnModuleInit {
  private baseUrl = getShopeeBaseUrl();
  private name = 'Shopee';

  constructor(
    private readonly auth: ShopeeAuthAdapter,
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly descriptionService: MarketplaceDescriptionService,
    private readonly listingService: ListingService, // [NEW] Inject
  ) { }

  onModuleInit() {
    this.registry.registerProductAdapter(this.name, this);
  }

  async getListings(params: any): Promise<any[]> {
    const mId = params.marketplaceId;
    const token = await this.auth.getValidToken(this.name);
    const items = await this.getItemList({
      limit: params?.limit || 50,
      offset: params?.offset || 0,
      status: params?.status ? (params.status === 'active' ? 'NORMAL' : undefined) : undefined
    }, token);

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
      // [REF] Fetch listings from service
      const allListings = await this.listingService.findByProduct(product._id);

      const titles = allListings.filter(t => String(t.marketplaceId) === String(marketplace.id));

      if (titles.length === 0) {
        titles.push({ title: product.name } as any);
      }

      // FIX: Fetch token here because updateProduct/createProduct rely on it
      const token = await this.auth.getValidToken(this.name);
      if (!token) {
        throw new Error('Falha ao obter token de acesso para Shopee');
      }

      // Attach token to product structure locally so downstream methods can use it
      const productWithToken = { ...product, token };
      // Note: product is a Document, spreading might not clone hidden properties, but we mostly need data.
      // However, ProductDocument might need toObject() first if it's a mongoose doc.
      // Ideally we modify a focused payload.
      // Let's rely on the fact downstream uses properties.
      // Safer: pass 'token' as property of the object passed as 'product'.
      (product as any).token = token;

      const results = [];
      for (const title of titles) {
        try {
          let result;
          let finalExternalId = title.externalId;
          if (!finalExternalId && titles.length === 1 && externalId) {
            finalExternalId = externalId;
          }

          // Pass the token-enriched product object
          const productPayload = { ...product, name: title.title, token };
          // Note: transformProductToShopee uses product properties.
          // updateProduct/createProduct extraction of token handles `product.token`.

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

  async getItemList(params: { offset?: number; limit?: number; status?: string }, token: any): Promise<any> {
    return this.executeWithRetry(async (currentToken) => {

      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/product/get_item_list';
      const signedParams = buildSignedParams(path, timestamp, currentToken.accessToken, currentToken.additionalData.shopId, {
        offset: params.offset || 0,
        page_size: params.limit || 20,
        item_status: params.status || 'NORMAL',
      });

      const response = await axios.get(`${this.baseUrl}${path}`, {
        headers: buildHeaders(),
        params: signedParams,
      });

      const payload = response.data || {};
      if (payload.error) {
        throw new Error(`Shopee Error: ${payload.message || payload.error}`);
      }

      const itemList = payload.response?.item_list || [];

      if (itemList.length > 0) {
        const itemIds = itemList.map((i: any) => i.item_id);
        return await this.getItemBaseInfo(itemIds, currentToken);
      }

      return [];
    }, token, 'getItemList');
  }

  async getItemBaseInfo(itemIds: number[], token: any): Promise<any[]> {
    return this.executeWithRetry(async (currentToken) => {

      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/product/get_item_base_info';
      const signedParams = buildSignedParams(path, timestamp, currentToken.accessToken, currentToken.additionalData.shopId, {
        item_id_list: itemIds
      });

      const response = await axios.get(`${this.baseUrl}${path}`, {
        headers: buildHeaders(),
        params: signedParams,
      });

      const payload = response.data || {};
      return payload.response?.item_list || [];
    }, token, 'getItemBaseInfo');
  }


  private async executeWithRetry<T>(
    operation: (token: any) => Promise<T>,
    token: any,
    context: string
  ): Promise<T> {
    try {
      return await operation(token);
    } catch (error: any) {
      const isAuthError = (error?.response?.status === 403) ||
        (error?.response?.status === 401) ||
        /invalid_acce?ess_token|invalid_access_token|error_auth/i.test(String(error?.response?.data?.error || error?.message || '')) ||
        (error?.response?.data?.message && /Invalid access_token/i.test(error.response.data.message));

      if (isAuthError) {
        let newToken;

        try {
          newToken = await this.auth.refreshToken(token);
        } catch (refreshError: any) {
          throw error; // If refresh fails, throw original auth error
        }

        if (newToken) {

          try {
            // Execute operation with NEW token
            const result: any = await operation(newToken);

            // If successful, attach the new token so caller can persist it if needed
            if (result && typeof result === 'object') {
              result.token = newToken;
            }
            return result;
          } catch (retryOperationError: any) {
            // If the RETRY itself fails (e.g. data validation, timeout), we must throw THIS error,
            // not the original auth error.
            throw retryOperationError;
          }
        }
      }
      throw error;
    }
  }


  private async uploadImage(imageUrl: string, token: any): Promise<any> {
    const timestamp = Math.floor(Date.now() / 1000)
    const path = '/media_space/upload_image'
    const shopId = token.additionalData?.shopId || token.shopId || token.shop_id;
    const params = buildSignedParams(path, timestamp, token.accessToken, shopId)
    try {
      let response: any
      try {
        const FormData = require('form-data')
        const fileResp = await axios.get(imageUrl, { responseType: 'arraybuffer' })
        const buffer = Buffer.from(fileResp.data)
        const fileNameGuess = (imageUrl.split('/').pop() || `image_${Date.now()}`).split('?')[0]
        const ct = /\.png$/i.test(fileNameGuess) ? 'image/png' : 'image/jpeg'
        const form = new FormData()
        form.append('image', buffer, { filename: fileNameGuess, contentType: ct, knownLength: buffer.length })
        const headers = { ...buildHeaders(), ...form.getHeaders() }

        response = await axios.post(`${this.baseUrl}${path}`, form, {
          headers,
          params,
          timeout: 30000 // 30s timeout
        })

      } catch (modErr) {
        response = await axios.post(`${this.baseUrl}${path}`, { image_url: imageUrl }, {
          headers: buildHeaders(),
          params,
          timeout: 30000
        })
      }
      const imageId = this.extractImageId(response.data)
      const imageUrlRet = response.data?.response?.image_url || response.data?.image_url || response.data?.url || imageUrl
      return { id: imageId, url: imageUrlRet }
    } catch (error: any) {
      const isWrongSign = (error?.response?.status === 403) || /wrong\s*sign/i.test(String(error?.response?.data?.message || error?.message || ''))
      if (isWrongSign) {
        try {
          const altParams = buildSignedParams(path, timestamp)
          let retry: any
          try {
            const FormData = require('form-data')
            const fileResp = await axios.get(imageUrl, { responseType: 'arraybuffer' })
            const buffer = Buffer.from(fileResp.data)
            const fileNameGuess = (imageUrl.split('/').pop() || `image_${Date.now()}`).split('?')[0]
            const ct = /\.png$/i.test(fileNameGuess) ? 'image/png' : 'image/jpeg'
            const form = new FormData()
            form.append('image', buffer, { filename: fileNameGuess, contentType: ct, knownLength: buffer.length })
            const headersAlt = { ...buildHeaders(), ...form.getHeaders() }
            retry = await axios.post(`${this.baseUrl}${path}`, form, { headers: headersAlt, params: altParams })
          } catch {
            retry = await axios.post(`${this.baseUrl}${path}`, { image_url: imageUrl }, { headers: buildHeaders(), params: altParams })
          }
          const imageId = retry.data?.response?.image_id || retry.data?.image_id || retry.data?.id
          const imageUrlRet = retry.data?.response?.image_url || retry.data?.image_url || retry.data?.url || imageUrl
          return { id: imageId, url: imageUrlRet }
        } catch (retryErr: any) {
          // silent fail
        }
      }
      if (error?.response?.data) throw new Error(JSON.stringify(error.response.data))
      throw new Error(`Falha no upload de imagem na Shopee: ${error.message}`)
    }
  }

  private async getImageIdsByUrl(urls: string[], token: any): Promise<string[]> {
    if (!urls || urls.length === 0) return []
    const timestamp = Math.floor(Date.now() / 1000)
    const path = '/media_space/get_image'
    const params = buildSignedParams(path, timestamp)
    try {
      const response = await axios.post(`${this.baseUrl}${path}`, { image_url_list: urls }, { headers: buildHeaders(), params })
      const list = response.data?.response?.image_id_list
        || response.data?.image_id_list
        || (response.data?.response?.images || []).map((x: any) => x.image_id)
        || (response.data?.images || []).map((x: any) => x.image_id)
      return Array.isArray(list) ? list.map((id: any) => String(id)) : []
    } catch (error: any) {
      try {
        const altParams = buildSignedParams(path, timestamp)
        const retry = await axios.post(`${this.baseUrl}${path}`, { image_url_list: urls }, { headers: buildHeaders(), params: altParams })
        const list = retry.data?.response?.image_id_list
          || retry.data?.image_id_list
          || (retry.data?.response?.images || []).map((x: any) => x.image_id)
          || (retry.data?.images || []).map((x: any) => x.image_id)
        return Array.isArray(list) ? list.map((id: any) => String(id)) : []
      } catch (retryErr: any) {
        return []
      }
    }
  }

  private extractImageId(data: any): string | undefined {
    if (!data) return undefined
    const candidates: any[] = []
    candidates.push(data?.response?.image_id)
    candidates.push(data?.image_id)
    candidates.push(data?.id)
    candidates.push(data?.response?.image?.image_id)
    candidates.push(data?.image?.image_id)
    candidates.push(data?.response?.image_info?.image_id)
    candidates.push(data?.image_info?.image_id)
    const lists = [
      data?.response?.images,
      data?.images,
      data?.response?.image_list,
      data?.image_list,
    ].filter(Boolean)
    for (const list of lists as any[]) {
      if (Array.isArray(list) && list.length) {
        const first = list[0]
        candidates.push(first?.image_id)
        candidates.push(first?.id)
      }
    }
    for (const c of candidates) {
      if (c !== undefined && c !== null && String(c).length > 0) return String(c)
    }
    try {
      const stack: any[] = [data]
      const seen = new Set<any>()
      while (stack.length) {
        const node = stack.pop()
        if (!node || typeof node !== 'object' || seen.has(node)) continue
        seen.add(node)
        for (const [k, v] of Object.entries(node)) {
          if (/image_?id/i.test(k) && v !== undefined && v !== null) return String(v)
          if (typeof v === 'object') stack.push(v)
        }
      }
    } catch { }
    return undefined
  }

  private async prepareImages(images: string[], token: any): Promise<string[]> {
    const result: string[] = []
    const uniqueImages = [...new Set(images || [])]
    for (const img of uniqueImages.slice(0, 9)) {
      try {
        const cleaned = typeof img === 'string' ? String(img).trim().replace(/^\s*[`'\"]|[`'\"]\s*$/g, '') : img
        if (typeof cleaned === 'string' && /^https?:\/\//.test(cleaned)) {
          const uploaded = await this.uploadImage(cleaned, token)
          if (uploaded?.id !== undefined && uploaded?.id !== null) {
            result.push(String(uploaded.id))
            continue
          }
          const ids = await this.getImageIdsByUrl([uploaded?.url || cleaned], token)
          if (ids.length > 0) {
            result.push(ids[0])
            continue
          }
          continue
        }
        const maybeId = cleaned as any
        if (maybeId !== undefined && maybeId !== null) {
          result.push(String(maybeId))
        }
      } catch (err: any) {
        // Critical: If the error is Auth-related, we MUST throw it so executeWithRetry can catch it
        // and refresh the token.
        const isAuthError = (err?.response?.status === 403) ||
          (err?.response?.status === 401) ||
          /invalid_acce?ess_token|invalid_access_token|error_auth/i.test(String(err?.response?.data?.error || err?.message || '')) ||
          (err?.response?.data?.message && /Invalid access_token/i.test(err.response.data.message));

        if (isAuthError) {
          throw err;
        }
        continue
      }
    }
    return result
  }

  async createProduct(product: any, marketplace?: any): Promise<any> {
    return this.executeWithRetry(async (currentToken) => {
      if (!currentToken) throw new Error('Token de acesso não fornecido para Shopee');

      // [REF] Try to find preview title from product wrapper if available (legacy style) or use name
      // Since createProduct is often called with enriched object, check properties
      let previewName = product.name;
      const productTitles = (product as any).productTitles as any[];
      if (productTitles && productTitles.length > 0) {
        const shopeeTitle = productTitles.find((t: any) => String(t.marketplaceId) === String(marketplace?.id || ''));
        if (shopeeTitle) previewName = shopeeTitle.title;
      }
      previewName = previewName || product.partNumber;

      if (product.token) {
        product.token = currentToken;
      }

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

        const timestamp = Math.floor(Date.now() / 1000);
        const path = '/product/add_item';
        const accessToken = currentToken.accessToken;
        const shopId = currentToken.additionalData?.shopId || currentToken.shopId;

        if (!accessToken || !shopId) {
          return {
            success: false,
            error: 'Token de acesso ou shopId ausente para criação de produto',
            requestPayload: shopeeProduct
          };
        }

        const params = buildSignedParams(path, timestamp, accessToken, shopId);

        let usedImageIds: string[] = [];
        if (Array.isArray(shopeeProduct.images) && shopeeProduct.images.length) {
          const prepared = await this.prepareImages(shopeeProduct.images, currentToken);
          usedImageIds = prepared;
          shopeeProduct.image = prepared.length > 0 ? { image_id_list: prepared } : undefined;

        }

        const imageField = shopeeProduct.image ? { image: shopeeProduct.image } : {};
        const finalPayload = { ...shopeeProduct, ...imageField, shop_id: parseInt(String(shopId)) };

        const response = await axios.post(`${this.baseUrl}${path}`, finalPayload, {
          headers: buildHeaders(),
          params: { ...params, access_token: accessToken, shop_id: parseInt(String(shopId)) },
          timeout: 45000 // 45s timeout for main creation
        });

        const payload = response.data || {};
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
        // CRITICAL: Rethrow Auth errors so executeWithRetry can handle token refresh!
        const isAuthError = (error?.response?.status === 403) ||
          (error?.response?.status === 401) ||
          /invalid_acce?ess_token|invalid_access_token|error_auth/i.test(String(error?.response?.data?.error || error?.message || '')) ||
          (error?.response?.data?.message && /Invalid access_token/i.test(error.response.data.message));

        if (isAuthError) {
          throw error;
        }

        return {
          success: false,
          error: error.response?.data?.message || error.message,
          requestPayload: shopeeProduct || null,
          responsePayload: error.response?.data || null
        };
      }
    }, product.token, 'createProduct');
  }

  private async getAvailableLogistics(token: any): Promise<number[]> {
    const timestamp = Math.floor(Date.now() / 1000)
    const path = '/logistics/get_channel_list'
    const params = buildSignedParams(path, timestamp, token.accessToken, token.additionalData.shopId)
    const response = await axios.get(`${this.baseUrl}${path}`, { headers: buildHeaders(), params })

    const payload = response.data || {}
    const list = payload.response?.logistics_channel_list
      || payload.response?.channel_list
      || payload.channel_list
      || payload.data?.channel_list
      || payload.data?.logistics_channel_list
      || []
    if (!Array.isArray(list)) return []
    const ids = list.map((x: any) => parseInt(String(x.logistic_id ?? x.logistics_channel_id ?? x.channel_id ?? x.id))).filter((v: any) => !isNaN(v))
    return ids
  }

  async updateProductPrice(externalId: string, price: number, token: any): Promise<any> {
    const timestamp = Math.floor(Date.now() / 1000);
    const path = '/product/update_price';
    const params = buildSignedParams(path, timestamp, token.accessToken, token.additionalData.shopId);

    try {
      const payload = {
        item_id: parseInt(externalId),
        price_list: [
          {
            original_price: price
          }
        ],
        shop_id: parseInt(token.additionalData.shopId)
      };

      const response = await axios.post(`${this.baseUrl}${path}`, payload, {
        headers: buildHeaders(),
        params
      });

      return response.data;
    } catch (error: any) {
      throw error;
    }
  }

  async updateProductStock(externalId: string, stock: number, token: any): Promise<any> {
    const timestamp = Math.floor(Date.now() / 1000);
    const path = '/product/update_stock';
    const params = buildSignedParams(path, timestamp, token.accessToken, token.additionalData.shopId);

    try {
      const payload = {
        item_id: parseInt(externalId),
        stock_list: [
          {
            seller_stock: [
              {
                stock: stock
              }
            ]
          }
        ],
        shop_id: parseInt(token.additionalData.shopId)
      };

      const response = await axios.post(`${this.baseUrl}${path}`, payload, {
        headers: buildHeaders(),
        params
      });

      return response.data;
    } catch (error: any) {
      throw error;
    }
  }

  async updateProduct(externalId: string, product: any, marketplace?: any): Promise<any> {
    return this.executeWithRetry(async (currentToken) => {

      if (!currentToken) throw new Error('Token de acesso não fornecido para Shopee');

      if (product.token) {
        product.token = currentToken;
      }

      const validation = await this.validateProduct(product);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Dados inválidos para atualização na Shopee: ${validation.missingRequirements.join('; ')}`,
          missingRequirements: validation.missingRequirements
        };
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/product/update_item';
      const accessToken = currentToken.accessToken;
      const shopId = currentToken.additionalData?.shopId;

      if (!accessToken) throw new Error('Token de acesso ausente para atualização de produto');
      if (!shopId) {
        console.error('[ShopeeAdapter] Token structure:', JSON.stringify(currentToken, null, 2));
        throw new Error('ShopId ausente para atualização de produto. Verifique logs.');
      }

      const params = buildSignedParams(path, timestamp, accessToken, shopId);
      const shopeeProduct = await this.transformProductToShopee(product, marketplace);

      // Check for price and stock updates using transformed values which handle fallbacks correctly
      // original_price and stock are numbers in shopeeProduct (from transformProductToShopee)
      if (shopeeProduct.original_price !== undefined && shopeeProduct.original_price > 0) {
        try {
          await this.updateProductPrice(externalId, Number(shopeeProduct.original_price), currentToken);
        } catch (e: any) {
          // Silent fail
        }
      }

      const stockVal = shopeeProduct.stock ?? shopeeProduct.quantity;
      if (stockVal !== undefined) {
        try {
          await this.updateProductStock(externalId, Number(stockVal), currentToken);
        } catch (e: any) {
          // Silent fail
        }
      }

      // Remove price and stock from generic update payload to avoid conflicts/redundancy
      delete shopeeProduct.original_price;
      delete shopeeProduct.stock;
      delete shopeeProduct.quantity;

      if (Array.isArray(shopeeProduct.images) && shopeeProduct.images.length) {
        const prepared = await this.prepareImages(shopeeProduct.images, currentToken);
        shopeeProduct.image = prepared.length > 0 ? { image_id_list: prepared } : undefined;
        delete shopeeProduct.images;
      }

      const finalPayload = {
        ...shopeeProduct,
        item_id: parseInt(externalId),
        shop_id: parseInt(String(shopId)),
      };

      const response = await axios.post(`${this.baseUrl}${path}`, finalPayload, {
        headers: buildHeaders(),
        params: { ...params, access_token: accessToken, shop_id: parseInt(String(shopId)) },
      });

      const payload = response.data || {};
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
    }, product.token, 'updateProduct');
  }

  async updateProductImages(externalId: string, images: any[]): Promise<any> {

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/product/update_item';
      const params = buildSignedParams(path, timestamp, images[0].token.accessToken, images[0].token.additionalData.shopId)

      let imagesPayload: any
      if (Array.isArray(images) && images.length) {
        const first = images[0]
        const hasIds = typeof first === 'number' || typeof first === 'string' || first.image_id !== undefined || first.id !== undefined
        if (hasIds) {
          const ids = images.map((img: any) => String(img.image_id ?? img.id ?? img))
          imagesPayload = { image_id_list: ids }
        } else if (first.url) {
          const imageUrlsRaw = images.map((img: any) => img.url)
          const prepared = await this.prepareImages(imageUrlsRaw, images[0].token)
          imagesPayload = prepared.length > 0 ? { image_id_list: prepared } : { image_url_list: imageUrlsRaw }
        }
      }

      const imageField: any = (() => {
        if (imagesPayload && typeof imagesPayload === 'object' && Array.isArray(imagesPayload.image_id_list)) {
          return { image: { image_id_list: imagesPayload.image_id_list } }
        }
        return {}
      })()
      const response = await axios.post(`${this.baseUrl}${path}`, {
        item_id: parseInt(externalId),
        ...imageField,
        shop_id: parseInt(images[0].token.additionalData.shopId),
      }, {
        headers: buildHeaders(),
        params: { ...params, access_token: images[0].token.accessToken, shop_id: parseInt(images[0].token.additionalData.shopId) },
      });


      return {
        externalId,
        status: 'active',
        marketplaceData: response.data,
        used_image_ids: Array.isArray(imagesPayload?.image_id_list) ? imagesPayload.image_id_list : [],
      };
    } catch (error: any) {
      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status)
      }
      try {
        const parsed = JSON.parse(error.message)
        throw new HttpException(parsed, 400)
      } catch { }
      throw new HttpException({ message: `Falha na atualização de imagens na Shopee: ${error.message}` }, 400)
    }
  }

  async updateProductTitle(externalId: string, title: string, token: any): Promise<any> {

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/product/update_item';
      const params = buildSignedParams(path, timestamp, token.accessToken, token.additionalData.shopId)

      // Simulação da chamada de atualização de título
      const response = await axios.post(`${this.baseUrl}${path}`, {
        item_id: parseInt(externalId),
        item_name: title,
        name: title,
        shop_id: parseInt(token.additionalData.shopId),
      }, {
        headers: buildHeaders(token.accessToken),
        params,
      });


      return {
        externalId,
        status: 'active',
        marketplaceData: response.data,
      };
    } catch (error: any) {
      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status)
      }
      try {
        const parsed = JSON.parse(error.message)
        throw new HttpException(parsed, 400)
      } catch { }
      throw new HttpException({ message: `Falha na atualização do título na Shopee: ${error.message}` }, 400)
    }
  }

  async updateProductCategory(externalId: string, category: any): Promise<any> {

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/product/update_item';
      const params = buildSignedParams(path, timestamp, category['token'].accessToken, category['token'].additionalData.shopId)

      const response = await axios.post(`${this.baseUrl}${path}`, {
        item_id: parseInt(externalId),
        category_id: parseInt(category.idOut),
        shop_id: parseInt(category['token'].additionalData.shopId),
      }, {
        headers: buildHeaders(category['token'].accessToken),
        params,
      });

      return {
        externalId,
        status: 'active',
        marketplaceData: response.data,
      };
    } catch (error: any) {
      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status)
      }
      try {
        const parsed = JSON.parse(error.message)
        throw new HttpException(parsed, 400)
      } catch { }
      throw new HttpException({ message: `Falha na atualização da categoria na Shopee: ${error.message}` }, 400)
    }
  }

  async updateProductInventory(externalId: string, inventory: any): Promise<any> {

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/product/update_stock';
      const params = buildSignedParams(path, timestamp, inventory['token'].accessToken, inventory['token'].additionalData.shopId)

      // Shopee V2 Structure: stock_list with model_id: 0 for simple products
      const payload = {
        item_id: parseInt(externalId),
        stock_list: [
          {
            model_id: 0,
            seller_stock: [{ stock: Number(inventory.quantity) }]
          }
        ],
        shop_id: parseInt(inventory['token'].additionalData.shopId),
      };

      const response = await axios.post(`${this.baseUrl}${path}`, payload, {
        headers: buildHeaders(inventory['token'].accessToken),
        params,
      });

      return {
        externalId,
        status: 'active',
        marketplaceData: response.data,
      };
    } catch (error: any) {
      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status)
      }
      try {
        const parsed = JSON.parse(error.message)
        throw new HttpException(parsed, 400)
      } catch { }
      throw new HttpException({ message: `Falha na atualização do estoque na Shopee: ${error.message}` }, 400)
    }
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
        console.log(`[ShopeeAdapter] Tentando gerar descrição via template para produto ${product._id} (Name: ${product.name})...`);
        const templateDesc = await this.descriptionService.generateDescription(product, this.name);
        console.log(`[ShopeeAdapter] Resultado template para ${product._id}: ${templateDesc ? 'Gerado com sucesso (' + templateDesc.length + ' chars)' : 'NULL (Nenhum template encontrado ou erro)'}`);

        // REMOVIDO: this.descriptionService.generateDescription(product, this.name);
        // O log já foi adicionado acima

        if (templateDesc) {
          description = templateDesc;
          console.log(`[ShopeeAdapter] Descrição substituída pelo template.`);
        }
      } catch (e) {
        console.error(`[ShopeeAdapter] Erro ao gerar descrição: ${e.message}`, e.stack);
      }
    } else {
      console.log(`[ShopeeAdapter] Pular geração de template. Service exists: ${!!this.descriptionService}, Marketplace passed: ${!!marketplace}`);
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
    const attributes: any[] = []
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
        })
      })
    }
    return attributes
  }
}

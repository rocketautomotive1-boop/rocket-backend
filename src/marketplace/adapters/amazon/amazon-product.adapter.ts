import { Injectable, Inject, forwardRef } from '@nestjs/common';
import axios from 'axios';
import * as aws4 from 'aws4';
import { ProductDocument } from '../../../product/product-types';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ModuleRef } from '@nestjs/core';
import { MarketplaceAuthService } from '../../auth/services/marketplace-auth.service';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { ListingService } from '../../../listing/listing.service'; // [NEW] Import

@Injectable()
export class AmazonProductAdapter implements IMarketplaceProductAdapter {

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly listingService: ListingService, // [NEW] Inject
  ) { }

  private getAuthService(): MarketplaceAuthService {
    return this.moduleRef.get(MarketplaceAuthService, { strict: false });
  }

  private getDescriptionService(): MarketplaceDescriptionService {
    return this.moduleRef.get(MarketplaceDescriptionService, { strict: false });
  }

  async publishProduct(product: ProductDocument, marketplace: MarketplaceDocument, externalId?: string): Promise<any> {
    try {
      // Ensure token exists
      if (!(product as any).token) {
        try {
          const authService = this.getAuthService();
          const marketplaceRepo = await authService.findByName('Amazon');
          if (marketplaceRepo) {
            const mId = marketplaceRepo._id;
            if (mId) {
              const token = await authService.ensureValidToken(String(mId));
              if (token) {
                (product as any).token = token;
              }
            }
          }
        } catch (e) {
          // Silent fail
        }
      }

      if (!product) {
        throw new Error('Produto não encontrado');
      }

      // [REF] Fetch listings from service instead of embedded array
      const allListings = await this.listingService.findByProduct(product._id);

      const titles = allListings.filter(t =>
        String(t.marketplaceId) === String(marketplace.id) ||
        String(t.marketplaceId) === '6' ||
        ((marketplace as any).mongoId && String(t.marketplaceId) === String((marketplace as any).mongoId))
      );

      if (titles.length === 0) {
        titles.push({ title: product.name } as any);
      }

      const results = [];
      for (const title of titles) {
        try {
          // STRICT MIRRORING LOGIC (Standardized):
          let finalExternalId = title.externalId;
          if (!finalExternalId && titles.length === 1 && externalId) {
            finalExternalId = externalId;
          }

          // Force specific title for this iteration
          // We clear titles in the clone so createProduct uses the forced product.name
          const productClone = { ...product, name: title.title, titles: [] };

          const amazonResult = await this.executeWithRetry(productClone, marketplace, finalExternalId);

          // Attach externalId if it was a create
          if (amazonResult.success && !amazonResult.externalId && amazonResult.result?.externalId) {
            amazonResult.externalId = amazonResult.result.externalId;
          }

          results.push({
            success: !!amazonResult.success,
            externalId: amazonResult.externalId,
            result: amazonResult.response || amazonResult,
            error: amazonResult.error,
            requestPayload: amazonResult.requestPayload,
            responsePayload: amazonResult.responsePayload,
            title: title.title
          });

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

  private async executeWithRetry(product: any, marketplace: MarketplaceDocument, externalId?: string): Promise<any> {
    try {
      const result = externalId
        ? await this.updateProduct(externalId, product)
        : await this.createProduct(product);

      const isAuthError = !result.success &&
        (/Unauthorized|access\s*token\s*expired/i.test(String(result.error || '')) ||
          result.responsePayload?.errors?.some((e: any) => e.code === 'Unauthorized'));

      if (isAuthError) {
        try {
          const newToken = await this.getAuthService().refreshToken(String(marketplace._id), product.token);
          if (newToken) {
            product.token = newToken;
            return await this.createProduct(product);
          }
        } catch (refreshError: any) {
          // Silent fail
        }
      }
      return result;
    } catch (error: any) {
      const isAuthError = (error?.response?.status === 403) ||
        (error?.response?.status === 401) ||
        /Unauthorized|access\s*token\s*expired/i.test(String(error?.response?.data?.message || error?.message || ''));

      if (isAuthError) {
        try {
          const newToken = await this.getAuthService().refreshToken(String(marketplace._id), product.token);
          if (newToken) {
            product.token = newToken;
            return await this.createProduct(product);
          }
        } catch (refreshError: any) {
          // Silent fail
        }
      }
      throw error;
    }
  }

  private getCredentials() {
    const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AMAZON_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
    const endpoint = process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Credenciais AWS (Access Key/Secret) não configuradas para Amazon SP-API.');
    }

    return { accessKeyId, secretAccessKey, region, endpoint };
  }

  async createProduct(product: any): Promise<any> {
    const { token } = product;
    if (!token || !token.accessToken) {
      throw new Error('Token de acesso LWA não fornecido.');
    }

    const sellerId = process.env.AMAZON_SELLER_ID || token.additionalData?.sellerId;
    if (!sellerId) {
      throw new Error('Seller ID não encontrado no token ou env var.');
    }

    const sku = String(product.id);
    const { accessKeyId, secretAccessKey, region, endpoint } = this.getCredentials();

    const forcedName = product.name;
    let finalTitle = forcedName;

    if (!finalTitle) {
      // [REF] Try to find specific title if possible, or fallback to name
      // Since 'titles' is removed from product object, we can't look it up here synchronously without service.
      // Assuming 'product.name' is correct or 'product.productTitles' was populated by service.
      // If standard payload has productTitles (from ProductService.getPayload), use it.
      const titles: any[] = (product as any).productTitles || [];
      const amazonTitle = titles.find(t => String(t.marketplaceId) === '6' || t.marketplaceName === 'Amazon')?.title;
      finalTitle = amazonTitle || product.name;
    }

    const finalPrice = Number(product.price) || Number(product.costPrice) || 0;

    const customBrand = product.brand?.amazonName?.trim();
    let brandValue = 'Generic';
    let forceExemption = false;

    if (customBrand && customBrand.length > 0) {
      brandValue = customBrand;
    } else {
      brandValue = 'Genérico';
      forceExemption = true;
    }

    const hasValidBarcode = product.barcode && product.barcode.length >= 13;
    const shouldSendEan = hasValidBarcode && !forceExemption;

    let productType = 'AUTO_PART';

    if (product.attributes) {
      const typeAttr = product.attributes.find((a: any) => a.code === 'amazon_product_type' || a.id === 'amazon_product_type');
      if (typeAttr && typeAttr.value) {
        productType = String(typeAttr.value);
      }
    }

    if ((product as any).amazonProductType) {
      productType = (product as any).amazonProductType;
    }

    let description = product.description || product.shortDescription || product.name || 'Peça de reposição de qualidade.';
    try {
      const service = this.getDescriptionService();
      if (service) {
        const templateDesc = await service.generateDescription(product, 'Amazon');
        if (templateDesc) description = templateDesc;
      }
    } catch (e) {
      // silent
    }

    const payload = {
      productType: productType,
      requirements: 'LISTING',
      attributes: {
        item_name: [{ value: finalTitle, language_tag: 'pt_BR' }],
        brand: [{ value: brandValue }],
        manufacturer: [{ value: brandValue }],
        part_number: [{ value: String(product.partNumber || product.id) }],
        model_name: [{ value: String(product.partNumber || product.id) || 'Peça Automotiva' }],
        bullet_point: [{ value: ((product.shortDescription || product.name) || 'Peça de reposição de qualidade').substring(0, 500), language_tag: 'pt_BR' }],
        product_description: [{ value: description.substring(0, 2000), language_tag: 'pt_BR' }],
        country_of_origin: [{ value: 'BR' }],
        supplier_declared_dg_hz_regulation: [{ value: 'not_applicable' }],
        external_testing_certification: [{ value: 'Not Applicable' }],
        required_product_compliance_certificate: [{ value: 'Not Applicable' }],
        generic_keyword: [{ value: (finalTitle || product.name || 'Peças Automotivas').substring(0, 200), language_tag: 'pt_BR' }],
        recommended_browse_nodes: [{ value: '17122858011' }],
        is_assembly_required: [{ value: false }],
        warranty_description: [{ value: product.warranty?.description || 'Garantia do Fabricante: 3 meses contra defeitos de fabricação.', language_tag: 'pt_BR' }],
        power_source_type: [{ value: 'air_powered' }],
        automotive_fit_type: [{ value: 'universal_fit' }],
        item_package_dimensions: [{
          length: { value: Number(product.dimensions?.length || product.length || 20), unit: 'centimeters' },
          width: { value: Number(product.dimensions?.width || product.width || 20), unit: 'centimeters' },
          height: { value: Number(product.dimensions?.height || product.height || 10), unit: 'centimeters' }
        }],
        item_package_weight: [{ value: Number(product.weight / 1000 || 0.5), unit: 'kilograms' }],
        number_of_boxes: [{ value: 1 }],
        contains_liquid_contents: [{ value: false }],
        included_components: [{ value: '1 Peça', language_tag: 'pt_BR' }],
        ...(shouldSendEan ? {
          externally_assigned_product_identifier: [{
            type: 'ean',
            value: product.barcode
          }]
        } : {
          supplier_declared_has_product_identifier_exemption: [{ value: true }]
        }),
        purchasable_offer: [{
          currency: 'BRL',
          our_price: [{
            schedule: [{
              value_with_tax: finalPrice,
              start_at: new Date().toISOString()
            }]
          }]
        }],
        list_price: [{ value_with_tax: finalPrice, currency: 'BRL' }],
        fulfillment_availability: [{
          fulfillment_channel_code: 'DEFAULT',
          quantity: Math.floor(Number(product.quantity || 0)),
          lead_time_to_ship_max_days: 2
        }],
      },
    };

    if (product.productImages && product.productImages.length > 0) {
      const sortedImages = product.productImages.sort((a, b) => (a.order || 0) - (b.order || 0));
      const mainImage = sortedImages[0]?.url;

      if (mainImage) {
        // @ts-ignore
        payload.attributes.main_product_image_locator = [{
          media_location: mainImage
        }];
      }

      sortedImages.slice(1, 4).forEach((img, index) => {
        if (img.url) {
          // @ts-ignore
          payload.attributes[`other_product_image_locator_${index + 1}`] = [{
            media_location: img.url
          }];
        }
      });
    }

    try {
      return await this.putListingItem(sku, finalTitle, payload, token);
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        requestPayload: payload
      };
    }
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    return this.createProduct(product);
  }

  private async putListingItem(sku: string, _sellerIdOrTitle: string, payload: any, token: any) {
    const { accessKeyId, secretAccessKey, region, endpoint } = this.getCredentials();
    const sellerId = process.env.AMAZON_SELLER_ID || token.additionalData?.sellerId;

    if (!sellerId) throw new Error('Seller ID missing for Amazon PUT');

    const path = `/listings/2021-08-01/items/${sellerId}/${sku}`;

    const requestOptions: aws4.Request = {
      host: endpoint.replace('https://', ''),
      path: `${path}?marketplaceIds=A2Q3Y263D00KWC`,
      method: 'PUT',
      headers: {
        'x-amz-access-token': token.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      region,
      service: 'execute-api',
    };

    aws4.sign(requestOptions, { accessKeyId, secretAccessKey });

    try {
      const { data } = await axios.put(`${endpoint}${path}?marketplaceIds=A2Q3Y263D00KWC`, payload, {
        headers: requestOptions.headers,
      });

      if (data.status === 'INVALID') {
        const issues = JSON.stringify(data.issues);
        return {
          success: false,
          error: `Amazon Recusou a oferta. Issues: ${issues}`,
          requestPayload: payload,
          responsePayload: data
        };
      }

      return {
        success: true,
        externalId: sku,
        data,
        requestPayload: payload,
        responsePayload: data
      };
    } catch (error: any) {
      let issues = error.message;
      if (error.response?.data) {
        const errorData = error.response.data;
        issues = errorData.issues ? JSON.stringify(errorData.issues) : JSON.stringify(errorData);
      }
      return {
        success: false,
        error: `Amazon Recusou a oferta. Issues: ${issues}`,
        requestPayload: payload,
        responsePayload: error.response?.data || null
      };
    }
  }

  async getListingItem(sku: string, token: any): Promise<any> {
    if (!token?.accessToken) throw new Error('Token inválido para Amazon');
    const { accessKeyId, secretAccessKey, region, endpoint } = this.getCredentials();
    const sellerId = token.additionalData?.sellerId || process.env.AMAZON_SELLER_ID;

    const path = `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`;
    const url = new URL(endpoint);

    const request = {
      host: url.host,
      path: `${path}?marketplaceIds=${process.env.AMAZON_MARKETPLACE_ID || 'A2Q3Y263D00KWC'}&includedData=summaries,offers,fulfillmentAvailability,issues`,
      service: 'execute-api',
      region,
      method: 'GET',
      headers: {
        'x-amz-access-token': token.accessToken,
      } as Record<string, string>
    };

    try {
      if (!request.headers) request.headers = {};
      aws4.sign(request as any, { accessKeyId, secretAccessKey });

      const signedUrl = `${endpoint}${request.path}`;
      const response = await axios.get(signedUrl, { headers: request.headers });
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) return null;
      return null;
    }
  }
}

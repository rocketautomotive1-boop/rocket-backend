import { Injectable } from '@nestjs/common';
import { ProductDocument } from '../../../product/product-types';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { ListingService } from '../../../listing/listing.service';
import { AmazonHttpClient } from './amazon-http-client';

@Injectable()
export class AmazonProductAdapter implements IMarketplaceProductAdapter {

  constructor(
    private readonly listingService: ListingService,
    private readonly descriptionService: MarketplaceDescriptionService,
    private readonly http: AmazonHttpClient,
  ) { }

  async publishProduct(product: ProductDocument, marketplace: MarketplaceDocument, externalId?: string): Promise<any> {
    try {
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

          // O auth-retry (refresh + 1 retry no 401/403) vive no AmazonHttpClient,
          // então aqui chamamos create/update direto.
          const amazonResult = finalExternalId
            ? await this.updateProduct(finalExternalId, productClone)
            : await this.createProduct(productClone);

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

  async createProduct(product: any): Promise<any> {
    const sellerId = process.env.AMAZON_SELLER_ID || product.token?.additionalData?.sellerId;
    if (!sellerId) {
      throw new Error('Seller ID não encontrado (AMAZON_SELLER_ID).');
    }

    const sku = String(product.id);

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

    const finalPrice = Number(product.price) || 0; // never publish at cost

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
      const templateDesc = await this.descriptionService.generateDescription(product, 'Amazon');
      if (templateDesc) description = templateDesc;
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
      return await this.putListingItem(sku, finalTitle, payload, sellerId);
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

  private get defaultMarketplaceId(): string {
    return process.env.AMAZON_MARKETPLACE_ID || 'A2Q3Y263D00KWC';
  }

  private async putListingItem(sku: string, _title: string, payload: any, sellerId: string) {
    if (!sellerId) throw new Error('Seller ID missing for Amazon PUT');

    const path = `/listings/2021-08-01/items/${sellerId}/${sku}`;

    try {
      // O AmazonHttpClient assina SigV4 + LWA e faz auth-retry; a query é
      // embutida na path assinada (não em params).
      const data = await this.http.request({
        method: 'PUT',
        path,
        query: { marketplaceIds: this.defaultMarketplaceId },
        body: payload,
      }, { context: 'putListingItem' }).then(r => r.data);

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
}

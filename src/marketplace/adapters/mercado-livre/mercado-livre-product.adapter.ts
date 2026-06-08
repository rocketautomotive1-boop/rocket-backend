import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { MercadoLivreAuthAdapter } from './mercado-livre-auth.adapter';
import { ProductService } from '../../../product/product.service';
import { MarketplaceService } from '../../services/marketplace.service';
import { MarketplaceIntegrationHelperService } from '../../services/marketplace-integration-helper.service';
import { MarketplaceDescriptionService } from '../../services/marketplace-description.service';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ProductDocument } from '../../../product/product-types';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MercadoLivreListingAdapter } from './mercado-livre-listing.adapter';
import { ListingService } from '../../../listing/listing.service'; // [NEW] Import

interface InventoryData {
  priceSale?: number;
  price?: number;
  quantity?: number;
  condition?: string;
}

@Injectable()
export class MercadoLivreProductAdapter implements IMarketplaceProductAdapter, OnModuleInit {
  private readonly logger = new Logger(MercadoLivreProductAdapter.name);

  constructor(
    @Inject(forwardRef(() => MercadoLivreAuthAdapter))
    private readonly authAdapter: MercadoLivreAuthAdapter,
    @Inject(forwardRef(() => ProductService))
    private readonly productService: ProductService,
    @Inject(forwardRef(() => MarketplaceService))
    private readonly marketplaceService: MarketplaceService,
    @Inject(forwardRef(() => MarketplaceIntegrationHelperService))
    private readonly helperService: MarketplaceIntegrationHelperService,
    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private readonly descriptionService: MarketplaceDescriptionService,
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly listingAdapter: MercadoLivreListingAdapter,
    private readonly listingService: ListingService, // [NEW] Inject ListingService
  ) { }

  private baseUrl = 'https://api.mercadolibre.com';
  private name = 'Mercado Livre';

  /** Log de resposta da API ML (envio); trunca payloads muito grandes. */
  private logMlSendResponse(
    operation: string,
    context: { externalId?: string; url?: string },
    status: number | undefined,
    data: unknown,
  ): void {
    const raw =
      typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data ?? '');
    const body = raw.length > 14000 ? `${raw.slice(0, 14000)}…[truncated ${raw.length} chars]` : raw;
    this.logger.log(
      `[ML API resposta] ${operation} status=${status ?? 'n/a'} ${JSON.stringify(context)} body=${body}`,
    );
  }

  onModuleInit() {
    this.registry.registerProductAdapter(this.name, this);
  }

  async getListings(params: any): Promise<any[]> {
    const listings = await this.listingAdapter.getListingMultiget();
    const mId = params.marketplaceId;
    return listings.map((l: any) => ({
      id: l.body.id,
      title: l.body.title,
      price: l.body.price,
      available_quantity: l.body.available_quantity,
      sold_quantity: l.body.sold_quantity,
      status: l.body.status,
      thumbnail: l.body.thumbnail,
      permalink: l.body.permalink,
      date_created: l.body.date_created,
      marketplace: {
        id: mId,
        name: this.name,
        type: 'mercadolivre',
        icon: 'store'
      }
    }));
  }

  async getListingDetail(externalId: string): Promise<any> {
    const token = await this.authAdapter.getValidToken(this.name);
    return this.getItem(externalId, token);
  }


  async getItem(externalId: string, accessToken: string): Promise<any> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/items/${externalId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      // Enhanced Error Logging
      const errorData = error.response?.data;
      const status = error.response?.status;

      if (status === 403) {
        // Return detailed error for 403 without retry
        throw new Error(`Falha ao consultar item no Mercado Livre (403): ${JSON.stringify(errorData || error.message)}`);
      }

      if (status === 401) {
        try {
          const mlMarketplace = await this.marketplaceService.findByName('Mercado Livre');
          if (mlMarketplace) {
            const newToken = await this.marketplaceService.refreshToken(mlMarketplace.id);
            const retryResponse = await axios.get(
              `${this.baseUrl}/items/${externalId}`,
              {
                headers: {
                  'Authorization': `Bearer ${newToken.accessToken}`,
                  'Content-Type': 'application/json',
                },
              }
            );
            return retryResponse.data;
          }
        } catch (refreshError) {
          // Silent fail
        }
      }
      throw new Error(`Falha ao consultar item no Mercado Livre: ${JSON.stringify(errorData || error.message)}`);
    }
  }

  public canUpdateItem(itemData: any): { canUpdate: boolean; restrictions: string[] } {
    const restrictions: string[] = [];

    const hasBids = itemData?.initial_quantity !== itemData?.available_quantity;
    const hasSales = (itemData?.sold_quantity || 0) > 0;

    if (hasBids) {
      restrictions.push('has_bids');
    }

    if (hasSales) {
      restrictions.push('has_sales');
    }

    if (itemData?.status === 'paused') {
      restrictions.push('item_paused');
    }
    if (itemData?.status === 'closed') {
      restrictions.push('item_closed');
    }

    const canUpdate = restrictions.length === 0;
    return { canUpdate, restrictions };
  }

  private filterUpdatableFields(updateData: any, restrictions: string[]): any {
    const filteredData = { ...updateData };

    if (restrictions.includes('has_bids') || restrictions.includes('has_sales')) {
      const restrictedFields = ['category_id', 'condition', 'buying_mode', 'listing_type_id', 'currency_id', 'title'];

      restrictedFields.forEach(field => {
        if (filteredData.hasOwnProperty(field)) {
          delete filteredData[field];
        }
      });

      if ((restrictions.includes('has_bids') || restrictions.includes('has_sales')) && filteredData.hasOwnProperty('attributes')) {
        delete filteredData.attributes;
      }
    }

    if (restrictions.includes('item_closed')) {
      const closedRestrictedFields = [
        'price', 'available_quantity', 'pictures', 'attributes', 'category_id',
        'condition', 'buying_mode', 'listing_type_id', 'currency_id', 'title'
      ];

      closedRestrictedFields.forEach(field => {
        if (filteredData.hasOwnProperty(field)) {
          delete filteredData[field];
        }
      });
    }

    return filteredData;
  }

  async updateProductConditional(externalId: string, mlData: any): Promise<any> {
    const token = mlData.accessToken;
    const dataToUpdate = { ...mlData };
    delete dataToUpdate.accessToken;

    try {
      const itemData = await this.getItem(externalId, token);
      const { restrictions } = this.canUpdateItem(itemData);
      const filteredData = this.filterUpdatableFields(dataToUpdate, restrictions);

      let status = 'success';
      if (restrictions.length > 0) {
        const originalKeys = Object.keys(dataToUpdate).filter(k => k !== 'description');
        const filteredKeys = Object.keys(filteredData);

        if (filteredKeys.length < originalKeys.length) {
          status = filteredKeys.length === 0 ? 'restricted' : 'partial_update';
        }
      }

      if (status === 'restricted' && Object.keys(dataToUpdate).length > 0) {
        return {
          success: false,
          status: 'restricted',
          message: `Item não pode ser atualizado devido a restrições: ${restrictions.join(', ')}`,
          requestPayload: dataToUpdate,
          responsePayload: { restrictions }
        };
      }

      const updateResponse = await axios.put(`${this.baseUrl}/items/${externalId}`, filteredData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      this.logMlSendResponse(
        'PUT /items/:id (updateProductConditional)',
        { externalId, url: `${this.baseUrl}/items/${externalId}` },
        updateResponse.status,
        updateResponse.data,
      );

      return {
        success: true,
        status,
        externalId,
        marketplaceData: updateResponse.data,
        data: updateResponse.data,
        requestPayload: filteredData,
        responsePayload: updateResponse.data
      };
    } catch (error) {
      if (error.response) {
        this.logger.warn(
          `[ML API erro] PUT /items/:id updateProductConditional externalId=${externalId} status=${error.response.status} data=${JSON.stringify(error.response.data)}`,
        );
      }
      if (error.response?.status === 401) {
        const mlMarketplace = await this.marketplaceService.findByName(this.name);
        if (mlMarketplace) {
          const newToken = await this.marketplaceService.refreshToken(mlMarketplace.id);
          mlData.accessToken = newToken.accessToken;
          return this.updateProductConditional(externalId, mlData);
        }
      }
      throw error;
    }
  }

  private validateAndConvertPrice(price: any): number {
    if (price === undefined || price === null) {
      return 0;
    }

    if (typeof price === 'string') {
      const parsedPrice = parseFloat(price.replace(',', '.'));
      return isNaN(parsedPrice) ? 0 : parsedPrice;
    }

    if (typeof price === 'number') {
      return price;
    }

    return 0;
  }

  private transformAttributes(product: any, marketplaceId?: any): any[] {
    const attributes = [];

    if (product.attributes && Array.isArray(product.attributes)) {
      // Only include attributes that belong to this marketplace (have a matching marketplaceId).
      // Rocket attributes have no marketplaceId and must not be sent to ML.
      const relevant = marketplaceId
        ? product.attributes.filter((a: any) => a.marketplaceId && String(a.marketplaceId) === String(marketplaceId))
        : product.attributes.filter((a: any) => !!a.marketplaceId);

      relevant.forEach(attr => {
        const attributeId = attr.categoryAttribute?.externalId || attr.code;

        if (attributeId && attr.value) {
          const attributeData: any = {
            id: attributeId
          };

          const strValue = String(attr.value);

          // Package dimension attributes require integer + unit format ("30 cm" / "500 g").
          // Normalise stale values that were stored without units (e.g. "30", "500.5").
          const DIMENSION_ATTRS: Record<string, string> = {
            SELLER_PACKAGE_HEIGHT: 'cm',
            SELLER_PACKAGE_WIDTH: 'cm',
            SELLER_PACKAGE_LENGTH: 'cm',
            SELLER_PACKAGE_WEIGHT: 'g',
          };
          if (DIMENSION_ATTRS[attributeId]) {
            const unit = DIMENSION_ATTRS[attributeId];
            // Strip existing unit suffix (if any) then round to integer
            const withoutUnit = strValue.replace(new RegExp(`\\s*${unit}$`), '').trim();
            const num = Math.round(parseFloat(withoutUnit.replace(',', '.')));
            if (!isNaN(num) && num > 0) {
              attributeData.value_name = `${num} ${unit}`;
              attributes.push(attributeData); // only push when value is valid
            }
            // If unparseable, skip so ensureMandatoryAttributes.injectDimension can handle it
            return;
          }

          // Build value fields based on attribute type
          if (attr.valueType === 'list' || attr.value_type === 'list') {
            attributeData.value_id = strValue;
            if (attr.valueName) attributeData.value_name = String(attr.valueName);
          } else if (attr.valueType === 'boolean') {
            attributeData.value_name = (strValue === 'true' || attr.value === true) ? 'Sim' : 'Não';
          } else {
            attributeData.value_name = attr.valueName ? String(attr.valueName) : strValue;
          }

          attributes.push(attributeData);
        }
      });
    }

    return attributes;
  }

  private ensureMandatoryAttributes(attributes: any[], product: any): any[] {
    if (!attributes.some(a => a.id === 'PART_NUMBER')) {
      if (product.partNumber) {
        attributes.push({ id: 'PART_NUMBER', value_name: product.partNumber });
      }
    }

    if (!attributes.some(a => a.id === 'BRAND')) {
      const brandName = product.brand?.name || product.brand?.amazonName || product.marketplaceBrandName;
      if (brandName) {
        attributes.push({ id: 'BRAND', value_name: brandName });
      }
    }

    // Inject Package Dimensions from product if missing.
    // ML requires integer values: "30 cm" / "500 g" — use Math.round().
    const injectDimension = (attrId: string, value: any, unit: string) => {
      if (!attributes.some(a => a.id === attrId)) {
        if (value) {
          const num = Math.round(parseFloat(String(value).replace(',', '.')));
          if (!isNaN(num) && num > 0) {
            attributes.push({ id: attrId, value_name: `${num} ${unit}` });
          }
        }
      }
    };

    injectDimension('SELLER_PACKAGE_WIDTH', product.dimensions?.width, 'cm');
    injectDimension('SELLER_PACKAGE_HEIGHT', product.dimensions?.height, 'cm');
    injectDimension('SELLER_PACKAGE_LENGTH', product.dimensions?.length, 'cm');
    injectDimension('SELLER_PACKAGE_WEIGHT', product.weight, 'g');

    return attributes;
  }

  async publishProduct(product: ProductDocument, marketplace: MarketplaceDocument, externalId?: string): Promise<any> {
    try {
      const token = await this.authAdapter.getValidToken(this.name);
      if (!token) {
        throw new Error('Token de acesso não disponível para o Mercado Livre');
      }

      const results = [];

      // [REF] Fetch listings from service instead of embedded array
      const allListings = await this.listingService.findByProduct(product._id);

      const titles = allListings.filter(t =>
        String(t.marketplaceId) === String(marketplace.id) ||
        ((marketplace as any).mongoId && String(t.marketplaceId) === String((marketplace as any).mongoId))
      );

      if (titles.length === 0) {
        // Fallback: transient object for new publication
        titles.push({ title: product.name, marketplaceId: marketplace.id } as any);
      }

      for (const title of titles) {
        try {
          let result;

          let finalExternalId = title.externalId;

          if (!finalExternalId && titles.length === 1 && externalId) {
            finalExternalId = externalId;
          }

          if (finalExternalId) {
            result = await this.updateExistingProduct({ ...title, externalId: finalExternalId }, product, token);
          } else {
            result = await this.createNewProduct(title, product, token);
          }
          results.push(result);
        } catch (error: any) {
          results.push({ success: false, error: error.message, title: title.title });
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

  private async updateExistingProduct(title: any, product: any, token: string): Promise<any> {
    const itemData = await this.getItem(title.externalId, token);
    const { restrictions } = this.canUpdateItem(itemData);
    const mlData = this.buildMercadoLivreUpdateData(title, product);
    let filteredData = this.filterUpdatableFields(mlData, restrictions);

    if (Object.keys(filteredData).length === 0) {
      const basicData: any = {};
      if (mlData.title) basicData.title = mlData.title;
      if (mlData.price) basicData.price = mlData.price;
      if (mlData.available_quantity !== undefined) basicData.available_quantity = mlData.available_quantity;

      if (Object.keys(basicData).length > 0) {
        filteredData = basicData;
      } else {
        return {
          success: false,
          externalId: title.externalId,
          error: `Item não pode ser atualizado devido a restrições: ${restrictions.join(', ')}`,
          requestPayload: mlData,
          responsePayload: { restrictions }
        };
      }
    }

    try {
      const updateResponse = await axios.put(`${this.baseUrl}/items/${title.externalId}`, filteredData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      this.logMlSendResponse(
        'PUT /items/:id (updateExistingProduct)',
        { externalId: title.externalId, url: `${this.baseUrl}/items/${title.externalId}` },
        updateResponse.status,
        updateResponse.data,
      );

      await this.updateProductDescription(title.externalId, product, title, token);

      return {
        success: true,
        externalId: title.externalId,
        data: updateResponse.data,
        requestPayload: filteredData,
        responsePayload: updateResponse.data
      };
    } catch (error) {
      if (error.response) {
        this.logger.warn(
          `[ML API erro] PUT /items/:id updateExistingProduct externalId=${title.externalId} status=${error.response.status} data=${JSON.stringify(error.response.data)}`,
        );
      }
      if (error.response?.status === 401) {
        const mlMarketplace = await this.marketplaceService.findByName('Mercado Livre');
        if (mlMarketplace) {
          const newToken = await this.marketplaceService.refreshToken(mlMarketplace.id);
          return this.updateExistingProduct(title, product, newToken.accessToken);
        }
      }

      return {
        success: false,
        error: `Erro ao atualizar: ${error.response?.data?.message || error.message} - Detalhes: ${JSON.stringify(error.response?.data?.cause || error.response?.data?.error || [])}`,
        externalId: title.externalId,
        requestPayload: filteredData,
        responsePayload: error.response?.data || null
      };
    }
  }

  private async createNewProduct(title: any, product: any, token: string): Promise<any> {
    const mlData = this.buildMercadoLivreCreateData(title, product);
    try {
      const createResponse = await axios.post(`${this.baseUrl}/items`, mlData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      this.logMlSendResponse(
        'POST /items (createNewProduct)',
        { url: `${this.baseUrl}/items` },
        createResponse.status,
        createResponse.data,
      );

      await this.updateProductDescription(createResponse.data.id, product, title, token);

      return {
        success: true,
        externalId: createResponse.data.id,
        data: createResponse.data,
        requestPayload: mlData,
        responsePayload: createResponse.data
      };
    } catch (error) {
      if (error.response) {
        this.logger.warn(
          `[ML API erro] POST /items createNewProduct status=${error.response.status} data=${JSON.stringify(error.response.data)}`,
        );
      }
      if (error.response?.status === 401) {
        try {
          const mlMarketplace = await this.marketplaceService.findByName('Mercado Livre');
          if (mlMarketplace) {
            const newToken = await this.marketplaceService.refreshToken(mlMarketplace.id);
            return this.createNewProduct(title, product, newToken.accessToken);
          }
        } catch (refreshError: any) {
          // Silent fail
        }
      }

      return {
        success: false,
        error: `Erro ao criar produto: ${error.response?.data?.message || error.message} - Detalhes: ${JSON.stringify(error.response?.data?.cause || error.response?.data?.error || [])}`,
        requestPayload: mlData,
        responsePayload: error.response?.data || null
      };
    }
  }

  private mapCategoryToML(category: any): string {
    console.log('[MercadoLivreAdapter] Mapping Category:', JSON.stringify(category));

    if (category?.externalId && String(category.externalId).startsWith('MLB')) {
      console.log('[MercadoLivreAdapter] Using direct externalId:', category.externalId);
      return category.externalId;
    }

    if (!category || category?.type === 'ObjectId' || typeof category === 'string') {
      console.warn('[MercadoLivreAdapter] Category is missing or invalid structure. Fallback to default.');
      return 'MLB1953'; // Fallback generic
    }

    const mapped = category?.marketplaceMappings?.find(m => m.marketplace === 'Mercado Livre' || m.marketplaceId === 1);
    if (mapped?.marketplaceCategory?.externalId) {
      console.log('[MercadoLivreAdapter] Using populated mapping externalId:', mapped.marketplaceCategory.externalId);
      return mapped.marketplaceCategory.externalId;
    }

    const name = category?.name?.toLowerCase() || '';
    if (name.includes('parachoque') || name.includes('para-choque')) return 'MLB1613';
    if (name.includes('farol') || name.includes('farois')) return 'MLB1605';
    if (name.includes('retrovisor')) return 'MLB1615';

    console.warn('[MercadoLivreAdapter] No mapping found. Fallback to MLB1953.');
    return 'MLB1953';
  }

  private buildMercadoLivreCreateData(title: any, product: any): any {
    const availableQty = Number(product.quantity ?? 0);
    const finalPrice = this.validateAndConvertPrice(product.price || 0); // never publish at cost

    return {
      title: title.title,
      category_id: this.mapCategoryToML(product.category as any),
      price: finalPrice,
      currency_id: 'BRL',
      listing_type_id: 'gold_pro',
      available_quantity: availableQty,
      buying_mode: 'buy_it_now',
      condition: 'new',
      pictures: product.productImages?.map(img => ({ source: img.url })) || [],
      seller_custom_field: product.id?.toString(),
      attributes: this.ensureMandatoryAttributes(this.transformAttributes(product, title.marketplaceId), product)
    };
  }

  private buildMercadoLivreUpdateData(title: any, product: any): any {
    const availableQty = Number(product.quantity ?? 0);
    const finalPrice = this.validateAndConvertPrice(product.price || 0); // never publish at cost
    const finalTitle = title.title || product.name;

    const updateData = {
      title: finalTitle,
      category_id: this.mapCategoryToML(product.category),
      price: finalPrice,
      currency_id: 'BRL',
      available_quantity: availableQty,
      buying_mode: 'buy_it_now',
      condition: 'new',
      pictures: product.productImages?.map(img => ({ source: img.url })) || [],
      seller_custom_field: product.id?.toString(),
      attributes: this.ensureMandatoryAttributes(this.transformAttributes(product, title.marketplaceId), product)
    };

    return updateData;
  }

  private buildMercadoLivreData(title: any, product: any): any {
    return this.buildMercadoLivreCreateData(title, product);
  }

  private async updateProductDescription(externalId: string, product: any, title: any, token: string): Promise<void> {
    try {
      product.name = title.title;
      const description = await this.descriptionService.generateDescription(product, this.name);

      const descRes = await axios.put(`${this.baseUrl}/items/${externalId}/description`, {
        plain_text: description
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      this.logMlSendResponse(
        'PUT /items/:id/description',
        { externalId, url: `${this.baseUrl}/items/${externalId}/description` },
        descRes.status,
        descRes.data,
      );
    } catch (error: any) {
      if (error.response) {
        this.logger.warn(
          `[ML API erro] PUT /items/:id/description externalId=${externalId} status=${error.response.status} data=${JSON.stringify(error.response.data)}`,
        );
      } else {
        this.logger.warn(`[ML API erro] PUT description externalId=${externalId} ${error?.message}`);
      }
    }
  }

  private validateUpdateResponse(externalId: string, sentPayload: any, responseData: any) {
    const errors: string[] = [];

    if (sentPayload.price !== undefined && responseData.price !== undefined) {
      const sent = Number(sentPayload.price);
      const received = Number(responseData.price);
      if (Math.abs(sent - received) > 0.05) {
        errors.push(`Preço divergente (Enviado: ${sent}, Recebido: ${received})`);
      }
    }

    if (sentPayload.available_quantity !== undefined && responseData.available_quantity !== undefined) {
      const sent = Number(sentPayload.available_quantity);
      const received = Number(responseData.available_quantity);
      if (sent !== received) {
        errors.push(`Estoque divergente (Enviado: ${sent}, Recebido: ${received})`);
      }
    }

    if (errors.length > 0) {
      const errorMessage = `Falha na validação de resposta do Mercado Livre para item ${externalId}: ${errors.join('; ')}`;
      throw new Error(errorMessage);
    }
  }
  // Interface Implementation
  async createProduct(context: any): Promise<any> {
    const token = context.token?.accessToken;
    if (!token) throw new Error('Token not found in context');

    // transform context to format expected by createNewProduct/buildMercadoLivreCreateData
    // The generic strategy passes { ...productPayload, name: title.title } as context.
    // buildMercadoLivreCreateData expects (title, product).
    // context is actually the product with some overrides.

    // We need to reconstruct the "title" object expected by internal methods
    const titleObj = { title: context.name, externalId: null };

    return this.createNewProduct(titleObj, context, token);
  }

  async updateProduct(externalId: string, context: any): Promise<any> {
    const token = context.token?.accessToken;
    if (!token) throw new Error('Token not found in context');

    const titleObj = { title: context.name, externalId };
    return this.updateExistingProduct(titleObj, context, token);
  }
}

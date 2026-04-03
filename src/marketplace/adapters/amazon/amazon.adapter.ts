import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import { AmazonAuthAdapter } from './amazon-auth.adapter';
import { AmazonProductAdapter } from './amazon-product.adapter';
import * as aws4 from 'aws4'
import * as crypto from 'crypto'
import axios from 'axios'
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ProductDocument } from '../../../product/product-types';
import { StandardOrder } from '../../model/order.interface';

@Injectable()
export class AmazonAdapter extends MarketplaceAdapter implements IMarketplaceProductAdapter, IMarketplaceOrderAdapter, OnModuleInit {
  name = 'Amazon';
  private readonly logger = new Logger(AmazonAdapter.name)

  constructor(
    private readonly authAdapter: AmazonAuthAdapter,
    private readonly productAdapter: AmazonProductAdapter,
    private readonly registry: MarketplaceAdapterRegistry
  ) {
    super();
  }

  onModuleInit() {
    this.registry.registerOrderAdapter(this.name, this);
    this.registry.registerProductAdapter(this.name, this);
  }

  private async executeWithRetry<T>(
    operation: (token: MarketplaceToken) => Promise<T>,
    context: string,
    requiresLwa = true,
  ): Promise<T> {
    const marketplace = await this.authAdapter.getMarketplaceByName(this.name);
    if (!marketplace) throw new Error(`Marketplace ${this.name} not found`);

    // getValidToken retorna ResolvedToken (pode ter accessToken=null se LWA não configurado)
    const resolved = await this.authAdapter.getValidToken(this.name);

    if (requiresLwa && !resolved.accessToken) {
      throw new Error(
        `Amazon SP-API: token LWA (Login with Amazon) não configurado. ` +
        `Complete o fluxo OAuth em GET /marketplace-auth/amazon/url e depois POST /marketplace-auth/amazon/callback. ` +
        `Operação bloqueada: ${context}`
      );
    }

    // Adaptar ResolvedToken para o shape esperado pelas operações legadas
    const token: MarketplaceToken = {
      accessToken: resolved.accessToken,
      refreshToken: resolved.refreshToken,
      expiresAt: resolved.expiresAt,
      isActive: true,
      additionalData: resolved.additionalData ?? {},
    } as MarketplaceToken;

    try {
      return await operation(token);
    } catch (error: any) {
      const isAuthError =
        error.response?.status === 403 ||
        error.response?.data?.errors?.[0]?.code === 'Unauthorized' ||
        error.response?.data?.errors?.[0]?.message?.includes('Access to requested resource is denied');

      if (isAuthError && token.refreshToken) {
        this.logger.warn(`Auth error in Amazon (${context}), refreshing token...`);
        try {
          const newToken = await this.authAdapter.refreshToken(token);
          this.logger.log(`Token refreshed for ${context}, retrying...`);
          return await operation(newToken);
        } catch (refreshError: any) {
          this.logger.error(`Failed to refresh Amazon token during retry (${context}): ${refreshError.message}`);
          throw error;
        }
      }
      throw error;
    }
  }

  async publishProduct(product: ProductDocument, marketplace: MarketplaceDocument, externalId?: string): Promise<any> {
    return this.productAdapter.publishProduct(product, marketplace, externalId);
  }

  // Auth methods
  async authenticate(credentials: any): Promise<MarketplaceToken> {
    return this.authAdapter.authenticate(credentials);
  }

  async refreshToken(token: MarketplaceToken): Promise<MarketplaceToken> {
    return this.authAdapter.refreshToken(token);
  }

  // Product methods
  async createProduct(product: any): Promise<any> {
    const tokenObj = product.token && product.token.accessToken
      ? product.token
      : {
        accessToken: product.accessToken || product.token,
        additionalData: { sellerId: product.sellerId || product.additionalData?.sellerId },
      };

    if (!tokenObj?.accessToken) {
      throw new Error('Token de acesso não fornecido para Amazon');
    }

    const productWithToken = { ...product, token: tokenObj };
    return this.productAdapter.createProduct(productWithToken);
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    const tokenObj = product.token && product.token.accessToken
      ? product.token
      : {
        accessToken: product.accessToken || product.token,
        additionalData: { sellerId: product.sellerId || product.additionalData?.sellerId },
      };

    const productWithToken = { ...product, token: tokenObj };
    return this.productAdapter.updateProduct(externalId, productWithToken);
  }

  async getOrders(params: any): Promise<StandardOrder[]> {
    return this.executeWithRetry(async (token) => {
      const region = process.env.AMAZON_AWS_REGION || 'us-east-1';
      const endpoint = process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';
      const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY;
      const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY;
      const marketplaceId = process.env.AMAZON_MARKETPLACE_ID;

      if (!accessKeyId || !secretAccessKey || !marketplaceId) {
        throw new Error('Amazon AWS credentials or Marketplace ID missing in env');
      }

      const marketplace = await this.authAdapter.getMarketplaceByName(this.name);

      const url = new URL(endpoint);
      const path = '/orders/v0/orders';

      const queryParams = new URLSearchParams({
        MarketplaceIds: marketplaceId,
        MaxResultsPerPage: String(Math.min(params.limit || 50, 100)),
      });

      if (params.createdAfter) {
        queryParams.append('CreatedAfter', params.createdAfter);
      } else {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        queryParams.append('CreatedAfter', date.toISOString());
      }

      if (params.status) {
        const statusMap: Record<string, string> = {
          'pending': 'Pending',
          'shipped': 'Shipped',
          'canceled': 'Canceled',
          'unshipped': 'Unshipped'
        };
        if (statusMap[params.status]) queryParams.append('OrderStatuses', statusMap[params.status]);
      }

      const request = {
        host: url.host,
        path: `${path}?${queryParams.toString()}`,
        service: 'execute-api',
        region,
        method: 'GET',
        headers: {
          'x-amz-access-token': token.accessToken,
        } as Record<string, string>,
      };

      aws4.sign(request as any, { accessKeyId, secretAccessKey });

      this.logger.log(`Fetching Amazon Orders: ${endpoint}${request.path}`);
      const response = await axios.get(`${endpoint}${request.path}`, { headers: request.headers });

      const orders = response.data.payload.Orders || [];

      const normalizedOrders = await Promise.all(orders.map(async (o: any) => {
        const order: StandardOrder = {
          id: o.AmazonOrderId,
          marketplaceId: String(marketplace._id),
          status: o.OrderStatus,
          date_created: o.PurchaseDate,
          total_amount: o.OrderTotal?.Amount ? Number(o.OrderTotal.Amount) : 0,
          currency_id: o.OrderTotal?.CurrencyCode || 'BRL',
          buyer: {
            id: o.BuyerInfo?.BuyerEmail || 'anonymous',
            nickname: o.BuyerInfo?.BuyerName || 'Comprador Amazon',
            name: o.BuyerInfo?.BuyerName || 'Comprador Amazon',
            first_name: o.BuyerInfo?.BuyerName?.split(' ')[0] || 'Comprador',
            last_name: o.BuyerInfo?.BuyerName?.split(' ').slice(1).join(' ') || '',
          },
          items: [],
          original_data: o,
          marketplaceName: this.name
        };

        try {
          const items = await this.getOrderItems(order.id, token);
          order.items = items;
        } catch (err) {
          this.logger.warn(`Failed to fetch items for Amazon order ${order.id}: ${err.message}`);
        }

        return order;
      }));

      return normalizedOrders;
    }, 'getOrders');
  }

  async getOrderDetails(orderId: string): Promise<StandardOrder> {
    return this.executeWithRetry(async (token) => {
      const region = process.env.AMAZON_AWS_REGION || 'us-east-1';
      const endpoint = process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';
      const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY;
      const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY;

      if (!accessKeyId || !secretAccessKey) throw new Error('Amazon AWS credentials missing');

      const url = new URL(endpoint);
      const path = `/orders/v0/orders/${orderId}`;

      const request = {
        host: url.host,
        path,
        service: 'execute-api',
        region,
        method: 'GET',
        headers: {
          'x-amz-access-token': token.accessToken,
        } as Record<string, string>,
      };

      aws4.sign(request as any, { accessKeyId, secretAccessKey });

      const response = await axios.get(`${endpoint}${path}`, { headers: request.headers });
      const o = response.data.payload;

      const shippingAddress = o.ShippingAddress;
      const buyerInfo = o.BuyerInfo;

      this.logger.log(`[ShippingAddress] raw payload: ${JSON.stringify(shippingAddress)}`);

      // Try fetching full PII address from /address endpoint (Tax Invoicing role required)
      let fullAddress: any = null;
      try {
        fullAddress = await this.getOrderShippingAddress(orderId, token.accessToken);
        this.logger.log(`[ShippingAddress] /address endpoint: ${JSON.stringify(fullAddress)}`);
      } catch (err: any) {
        const requestId = err?.response?.headers?.['x-amzn-requestid'] || 'N/A';
        this.logger.warn(`[ShippingAddress] /address FALHOU — x-amzn-RequestId: ${requestId} | ${err.message}`);
      }

      const addr = fullAddress ?? shippingAddress;
      const cep = (addr?.PostalCode || '').replace(/\D/g, '');

      // When Amazon doesn't return street/neighborhood (common even with Tax Invoicing role),
      // look them up via ViaCEP using the postal code.
      let viacep: any = null;
      if (cep && cep.length === 8 && (!addr?.AddressLine1)) {
        try {
          const vcRes = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 5000 });
          if (vcRes.data && !vcRes.data.erro) {
            viacep = vcRes.data;
            this.logger.log(`[ViaCEP] ${cep} → ${viacep.logradouro}, ${viacep.bairro}, ${viacep.localidade}/${viacep.uf}`);
          }
        } catch (err: any) {
          this.logger.warn(`[ViaCEP] falhou para CEP ${cep}: ${err.message}`);
        }
      }

      const recipientName = addr?.Name || fullAddress?.Name || buyerInfo?.BuyerName || 'Comprador Amazon';

      // Normalize buyer data — document is empty here, enriched below via RDT
      const buyer: any = {
        id: buyerInfo?.BuyerEmail || 'anonymous',
        nickname: buyerInfo?.BuyerName || 'Comprador Amazon',
        name: recipientName,
        first_name: recipientName.split(' ')[0] || 'Comprador',
        last_name: recipientName.split(' ').slice(1).join(' ') || '',
        document: '',
        address: addr ? {
          street:       addr.AddressLine1 || viacep?.logradouro || '',
          number:       addr.AddressLine2 || 'S/N',
          neighborhood: addr.AddressLine3 || viacep?.bairro || '',
          city:         addr.City || viacep?.localidade || '',
          state:        addr.StateOrRegion || viacep?.uf || '',
          zipCode:      cep,
          country:      addr.CountryCode || 'BR',
        } : undefined,
      };

      // ── Enrich buyer document (CPF/CNPJ) ─────────────────────────────────────
      // Strategy 1: TaxClassifications may already be in the main order response
      // (available without RDT when the buyer provided their CPF at checkout on Amazon BR)
      buyer.document = this.extractBuyerDocument(buyerInfo);
      this.logger.log(`Amazon BuyerTaxInfo (main response): ${JSON.stringify(buyerInfo?.BuyerTaxInfo)}`);

      // If CPF not in main response, call /buyerInfo directly (no RDT needed per SP-API v2026-01-01)
      if (!buyer.document) {
        try {
          const extendedBuyerInfo = await this.getOrderBuyerInfo(orderId, token.accessToken);
          this.logger.log(`[buyerInfo] TaxClassifications: ${JSON.stringify(extendedBuyerInfo?.BuyerTaxInfo?.TaxClassifications ?? extendedBuyerInfo?.TaxClassifications ?? 'não encontrado')}`);
          buyer.document = this.extractBuyerDocument(extendedBuyerInfo);
          if (extendedBuyerInfo?.BuyerName) buyer.name = extendedBuyerInfo.BuyerName;
          this.logger.log(`[buyerInfo] Documento extraído: "${buyer.document || '(vazio)'}"`);
        } catch (err: any) {
          const requestId = (err as any).response?.headers?.['x-amzn-requestid'] || 'N/A';
          this.logger.warn(`[buyerInfo] FALHOU (${orderId}) — x-amzn-RequestId: ${requestId} | ${err.message}`);
        }
      }

      let items = [];
      try {
        items = await this.getOrderItems(orderId, token);
      } catch (err) {
        this.logger.warn(`Failed to fetch items for Amazon order ${orderId}: ${err.message}`);
      }

      const marketplace = await this.authAdapter.getMarketplaceByName(this.name);

      return {
        id: String(o.AmazonOrderId),
        marketplaceId: marketplace ? String(marketplace._id) : null,
        marketplaceName: this.name,
        status: o.OrderStatus,
        date_created: o.PurchaseDate,
        total_amount: o.OrderTotal?.Amount ? Number(o.OrderTotal.Amount) : 0,
        currency_id: o.OrderTotal?.CurrencyCode || 'BRL',
        buyer,
        items,
        original_data: o
      };
    }, 'getOrderDetails');
  }

  /**
   * Fetches buyer PII (CPF/CNPJ) from GET /orders/v0/orders/{orderId}/buyerInfo.
   *
   * Tries three token strategies in order:
   *   1. RDT without dataElements (path-only restriction — works if app has Orders role)
   *   2. RDT with dataElements ['buyerInfo'] (requires PII approval in SP-API Console)
   *   3. Regular LWA token (last resort — may work for some seller configurations)
   */
  /**
   * Fetches buyer PII (name, CPF/CNPJ) from GET /orders/v0/orders/{orderId}/buyerInfo.
   *
   * Per Amazon SP-API docs (v2026-01-01), RDT is NOT required for PII access —
   * the regular LWA access token is sufficient when the app has the appropriate
   * restricted roles (Tax Invoicing / Direct-to-Consumer Shipping).
   */
  private async getOrderBuyerInfo(orderId: string, accessToken: string): Promise<any> {
    const { accessKeyId, secretAccessKey, region, endpoint } = this.getCredentials();
    const path = `/orders/v0/orders/${orderId}/buyerInfo`;
    const url = new URL(endpoint);

    const request = {
      host: url.host,
      path,
      service: 'execute-api',
      region,
      method: 'GET',
      headers: { 'x-amz-access-token': accessToken } as Record<string, string>,
    };
    aws4.sign(request as any, { accessKeyId, secretAccessKey });

    const res = await axios.get(`${endpoint}${path}`, { headers: request.headers });
    const requestId = res.headers?.['x-amzn-requestid'] || 'N/A';
    this.logger.log(`[buyerInfo] OK — x-amzn-RequestId: ${requestId}`);
    return res.data?.payload?.BuyerInfo ?? res.data?.payload ?? null;
  }

  /**
   * Fetches the full shipping address (PII) from GET /orders/v0/orders/{orderId}/address.
   * Requires the Tax Invoicing or Direct-to-Consumer Shipping restricted role.
   * Falls back silently — caller logs the error.
   */
  private async getOrderShippingAddress(orderId: string, accessToken: string): Promise<any> {
    const { accessKeyId, secretAccessKey, region, endpoint } = this.getCredentials();
    const path = `/orders/v0/orders/${orderId}/address`;
    const url = new URL(endpoint);

    const request = {
      host: url.host,
      path,
      service: 'execute-api',
      region,
      method: 'GET',
      headers: { 'x-amz-access-token': accessToken } as Record<string, string>,
    };
    aws4.sign(request as any, { accessKeyId, secretAccessKey });

    const res = await axios.get(`${endpoint}${path}`, { headers: request.headers });
    const requestId = res.headers?.['x-amzn-requestid'] || 'N/A';
    this.logger.log(`[ShippingAddress] /address OK — x-amzn-RequestId: ${requestId}`);
    return res.data?.payload?.ShippingAddress ?? res.data?.payload ?? null;
  }

  /**
   * Extracts the CPF or CNPJ from Amazon's BuyerTaxInfo.TaxClassifications array.
   * Returns an empty string when no tax classification is found.
   */
  private extractBuyerDocument(buyerInfo: any): string {
    const classifications: Array<{ Name: string; Value: string }> =
      buyerInfo?.BuyerTaxInfo?.TaxClassifications ?? [];

    const cpf  = classifications.find(t => t.Name === 'CPF');
    const cnpj = classifications.find(t => t.Name === 'CNPJ');
    const found = cpf ?? cnpj;

    return found?.Value ?? '';
  }

  async getOrderItems(orderId: string, token: MarketplaceToken): Promise<any[]> {
    const region = process.env.AMAZON_AWS_REGION || 'us-east-1';
    const endpoint = process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';
    const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY;
    const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY;

    if (!accessKeyId || !secretAccessKey) return [];

    const url = new URL(endpoint);
    const path = `/orders/v0/orders/${orderId}/orderItems`;

    const request = {
      host: url.host,
      path,
      service: 'execute-api',
      region,
      method: 'GET',
      headers: {
        'x-amz-access-token': token.accessToken,
      } as Record<string, string>,
    };

    aws4.sign(request as any, { accessKeyId, secretAccessKey });

    const response = await axios.get(`${endpoint}${path}`, { headers: request.headers });
    const items = response.data.payload.OrderItems || [];

    return items.map((item: any) => ({
      id: item.OrderItemId,
      quantity: item.QuantityOrdered,
      unit_price: item.ItemPrice?.Amount ? (Number(item.ItemPrice.Amount) / item.QuantityOrdered) : 0,
      currency_id: item.ItemPrice ? item.ItemPrice.CurrencyCode : 'BRL',
      sku: item.SellerSKU,
      asin: item.ASIN ?? null,
      title: item.Title,
    }));
  }

  async getListings(params: any): Promise<any[]> {
    return this.executeWithRetry(async (token) => {
      const mId = params.marketplaceId;

      if (params?.search) {
        const liveData = await this.getListingDetail(params.search);
        if (!liveData) return [];
        const summary = liveData.summaries?.[0];
        const offer = liveData.offers?.[0];
        return [{
          id: params.search,
          title: summary?.itemName || 'Produto Encontrado',
          price: offer?.price?.amount || 0,
          available_quantity: 0,
          sold_quantity: 0,
          status: liveData.status || 'active',
          thumbnail: summary?.mainImage?.link || '',
          permalink: '',
          date_created: summary?.createdDate || new Date().toISOString(),
          marketplace: {
            id: mId,
            name: this.name,
            type: 'amazon',
            icon: 'amazon'
          }
        }];
      }

      return []; // Multiget requires ProductTitleService which we'll handle at service level for now if needed, or pass IDs in params.
    }, 'getListings');
  }

  async getListingDetail(sku: string): Promise<any> {
    return this.executeWithRetry(async (token) => {
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
        aws4.sign(request as any, { accessKeyId, secretAccessKey });
        const signedUrl = `${endpoint}${request.path}`;
        const response = await axios.get(signedUrl, { headers: request.headers });
        return response.data;
      } catch (error) {
        if (error.response?.status === 404) return null;
        this.logger.error(`Erro buscando listing item Amazon (${sku}):`, error.message);
        return null;
      }
    }, 'getListingDetail');
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

  /**
   * Returns the first FBA ShipmentId associated with an AmazonOrderId.
   * Required by the Shipment Invoicing API v0 which uses ShipmentId (not OrderId) as path param.
   */
  private async getShipmentId(orderId: string, accessToken: string): Promise<string> {
    const { accessKeyId, secretAccessKey, region, endpoint } = this.getCredentials();
    const path = `/fba/outbound/brazil/v0/shipments?amazonOrderId=${encodeURIComponent(orderId)}`;
    const request = {
      host: new URL(endpoint).host,
      path,
      service: 'execute-api',
      region,
      method: 'GET',
      headers: { 'x-amz-access-token': accessToken } as Record<string, string>,
    };
    aws4.sign(request as any, { accessKeyId, secretAccessKey });
    const response = await axios.get(`${endpoint}${path}`, { headers: request.headers });
    const shipments = response.data?.payload?.Shipments || [];
    if (!shipments.length) {
      throw new Error(`Nenhum shipment FBA encontrado para o pedido Amazon ${orderId}. Verifique se o pedido é FBA.`);
    }
    return shipments[0].ShipmentId;
  }

  /**
   * Submits the NF-e XML to Amazon via the Shipment Invoicing API v0.
   * Endpoint: POST /fba/outbound/brazil/v0/shipments/{shipmentId}/invoice
   * Body: { InvoiceContent: base64(xml), ContentMD5Value: base64(md5(xml)) }
   */
  async uploadInvoice(orderId: string, xmlContent: string, options?: { packId?: string; pdfBase64?: string }): Promise<any> {
    return this.executeWithRetry(async (token) => {
      const { accessKeyId, secretAccessKey, region, endpoint } = this.getCredentials();

      const shipmentId = await this.getShipmentId(orderId, token.accessToken);
      this.logger.log(`[uploadInvoice] shipmentId=${shipmentId} para pedido=${orderId}`);

      const xmlBuffer = Buffer.from(xmlContent, 'utf-8');
      const md5Base64 = crypto.createHash('md5').update(xmlBuffer).digest('base64');
      const invoiceContent = xmlBuffer.toString('base64');

      const path = `/fba/outbound/brazil/v0/shipments/${encodeURIComponent(shipmentId)}/invoice`;
      const body = { InvoiceContent: invoiceContent, ContentMD5Value: md5Base64 };

      const request = {
        host: new URL(endpoint).host,
        path,
        service: 'execute-api',
        region,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-amz-access-token': token.accessToken,
        } as Record<string, string>,
        body: JSON.stringify(body),
      };
      aws4.sign(request as any, { accessKeyId, secretAccessKey });

      const response = await axios.post(`${endpoint}${path}`, body, { headers: request.headers });
      const errors = response.data?.errors || [];
      if (errors.length > 0) {
        throw new Error(`Amazon NF-e upload falhou: ${errors.map((e: any) => e.message).join('; ')}`);
      }

      this.logger.log(`[uploadInvoice] NF-e enviada com sucesso — shipmentId=${shipmentId}`);
      return { success: true, shipmentId, response: response.data };
    }, 'uploadInvoice');
  }

  async updateProductImages(externalId: string, images: any[]): Promise<any> { throw new Error('Method not implemented.'); }
  async updateOrderStatus(orderId: string, status: string, token?: any): Promise<any> { throw new Error('Method not implemented.'); }
  async updateProductTitle(externalId: string, title: string): Promise<any> { throw new Error('Method not implemented.'); }
  async updateProductCategory(externalId: string, category: any): Promise<any> { throw new Error('Method not implemented.'); }
  async updateProductInventory(externalId: string, inventory: any): Promise<any> { throw new Error('Method not implemented.'); }
  async validateProduct(product: any): Promise<{ isValid: boolean; missingRequirements: string[]; }> {
    return { isValid: true, missingRequirements: [] };
  }
}

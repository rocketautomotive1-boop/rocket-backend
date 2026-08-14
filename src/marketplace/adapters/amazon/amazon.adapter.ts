import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import { AmazonAuthAdapter } from './amazon-auth.adapter';
import { AmazonProductAdapter } from './amazon-product.adapter';
import { AmazonHttpClient } from './amazon-http-client';
import { HttpAuthContext } from '../shared/marketplace-http-client';
import * as crypto from 'crypto'
import axios from 'axios' // apenas para ViaCEP (lookup de endereço por CEP), não SP-API
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
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly http: AmazonHttpClient,
  ) {
    super();
  }

  onModuleInit() {
    this.registry.registerOrderAdapter(this.name, this);
    this.registry.registerProductAdapter(this.name, this);
  }

  /** Marketplace BR padrão (env via token; fallback p/ o BR conhecido). */
  private get defaultMarketplaceId(): string {
    return process.env.AMAZON_MARKETPLACE_ID || 'A2Q3Y263D00KWC';
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

  // Product methods — token/SigV4 são resolvidos dentro do AmazonHttpClient, então
  // o umbrella só delega (sem threadar token).
  async createProduct(product: any): Promise<any> {
    return this.productAdapter.createProduct(product);
  }

  async updateProduct(externalId: string, product: any): Promise<any> {
    return this.productAdapter.updateProduct(externalId, product);
  }

  async getOrders(params: any): Promise<StandardOrder[]> {
    const ctx = { context: 'getOrders', accountId: params?.accountId, domain: params?.domain };
    const marketplace = await this.authAdapter.getMarketplaceByName(this.name);

    const query: Record<string, any> = {
      MarketplaceIds: this.defaultMarketplaceId,
      MaxResultsPerPage: Math.min(params.limit || 50, 100),
    };

    if (params.createdAfter) {
      query.CreatedAfter = params.createdAfter;
    } else {
      const date = new Date();
      date.setDate(date.getDate() - 30);
      query.CreatedAfter = date.toISOString();
    }

    if (params.status) {
      const statusMap: Record<string, string> = {
        'pending': 'Pending',
        'shipped': 'Shipped',
        'canceled': 'Canceled',
        'unshipped': 'Unshipped'
      };
      if (statusMap[params.status]) query.OrderStatuses = statusMap[params.status];
    }

    const data = await this.http.get('/orders/v0/orders', ctx, query);
    const orders = data.payload?.Orders || [];

    return Promise.all(orders.map(async (o: any) => {
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
        order.items = await this.getOrderItems(order.id, ctx);
      } catch (err) {
        this.logger.warn(`Failed to fetch items for Amazon order ${order.id}: ${err.message}`);
      }

      return order;
    }));
  }

  async getOrderDetails(orderId: string, accountId?: string): Promise<StandardOrder> {
    const ctx = { context: 'getOrderDetails', accountId };
    {
      const data = await this.http.get(`/orders/v0/orders/${orderId}`, ctx);
      const o = data.payload;

      const shippingAddress = o.ShippingAddress;
      const buyerInfo = o.BuyerInfo;

      this.logger.log(`[ShippingAddress] raw payload: ${JSON.stringify(shippingAddress)}`);

      // Try fetching full PII address from /address endpoint (Tax Invoicing role required)
      let fullAddress: any = null;
      try {
        fullAddress = await this.getOrderShippingAddress(orderId, ctx);
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
          const extendedBuyerInfo = await this.getOrderBuyerInfo(orderId, ctx);
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
        items = await this.getOrderItems(orderId, ctx);
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
    }
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
  private async getOrderBuyerInfo(orderId: string, ctx: HttpAuthContext): Promise<any> {
    const res = await this.http.request(
      { method: 'GET', path: `/orders/v0/orders/${orderId}/buyerInfo` },
      { ...ctx, context: 'getOrderBuyerInfo' },
    );
    const requestId = res.headers?.['x-amzn-requestid'] || 'N/A';
    this.logger.log(`[buyerInfo] OK — x-amzn-RequestId: ${requestId}`);
    return res.data?.payload?.BuyerInfo ?? res.data?.payload ?? null;
  }

  /**
   * Fetches the full shipping address (PII) from GET /orders/v0/orders/{orderId}/address.
   * Requires the Tax Invoicing or Direct-to-Consumer Shipping restricted role.
   * Falls back silently — caller logs the error.
   */
  private async getOrderShippingAddress(orderId: string, ctx: HttpAuthContext): Promise<any> {
    const res = await this.http.request(
      { method: 'GET', path: `/orders/v0/orders/${orderId}/address` },
      { ...ctx, context: 'getOrderShippingAddress' },
    );
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

  async getOrderItems(orderId: string, ctx: HttpAuthContext): Promise<any[]> {
    const data = await this.http.get(`/orders/v0/orders/${orderId}/orderItems`, {
      ...ctx,
      context: 'getOrderItems',
    });
    const items = data.payload?.OrderItems || [];

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
  }

  async getListingDetail(sku: string): Promise<any> {
    const sellerId = this.defaultSellerId;
    if (!sellerId) throw new Error('Seller ID (AMAZON_SELLER_ID) não configurado para Amazon SP-API.');

    const path = `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`;
    try {
      return await this.http.get(path, { context: 'getListingDetail' }, {
        marketplaceIds: this.defaultMarketplaceId,
        includedData: 'summaries,offers,fulfillmentAvailability,issues',
      });
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      this.logger.error(`Erro buscando listing item Amazon (${sku}):`, error.message);
      return null;
    }
  }

  /** Seller ID padrão (env via token; AMAZON_SELLER_ID). */
  private get defaultSellerId(): string {
    return process.env.AMAZON_SELLER_ID || '';
  }

  /**
   * Returns the first FBA ShipmentId associated with an AmazonOrderId.
   * Required by the Shipment Invoicing API v0 which uses ShipmentId (not OrderId) as path param.
   */
  private async getShipmentId(orderId: string, ctx: HttpAuthContext): Promise<string> {
    const data = await this.http.get('/fba/outbound/brazil/v0/shipments', { ...ctx, context: 'getShipmentId' }, {
      amazonOrderId: orderId,
    });
    const shipments = data?.payload?.Shipments || [];
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
    const ctx = { context: 'uploadInvoice' };

    const shipmentId = await this.getShipmentId(orderId, ctx);
    this.logger.log(`[uploadInvoice] shipmentId=${shipmentId} para pedido=${orderId}`);

    const xmlBuffer = Buffer.from(xmlContent, 'utf-8');
    const md5Base64 = crypto.createHash('md5').update(xmlBuffer).digest('base64');
    const invoiceContent = xmlBuffer.toString('base64');

    const path = `/fba/outbound/brazil/v0/shipments/${encodeURIComponent(shipmentId)}/invoice`;
    const body = { InvoiceContent: invoiceContent, ContentMD5Value: md5Base64 };

    const data = await this.http.post(path, ctx, body);
    const errors = data?.errors || [];
    if (errors.length > 0) {
      throw new Error(`Amazon NF-e upload falhou: ${errors.map((e: any) => e.message).join('; ')}`);
    }

    this.logger.log(`[uploadInvoice] NF-e enviada com sucesso — shipmentId=${shipmentId}`);
    return { success: true, shipmentId, response: data };
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

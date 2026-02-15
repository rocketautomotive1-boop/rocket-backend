import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { MarketplaceAdapter } from '../../../common/adapters/marketplace.adapter';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import { AmazonAuthAdapter } from './amazon-auth.adapter';
import { AmazonProductAdapter } from './amazon-product.adapter';
import * as aws4 from 'aws4'
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
    context: string
  ): Promise<T> {
    const marketplace = await this.authAdapter.getMarketplaceByName(this.name);
    if (!marketplace) throw new Error(`Marketplace ${this.name} not found`);

    // Fallback if ensureValidToken not available on authAdapter, we might need a generic one
    // But AmazonAuthAdapter usually handles this.
    // Actually AmazonAdapter was receiving token in params.
    // Standardizing to fetch it like ML and Shopee.
    const token = await this.authAdapter.getValidToken(this.name);

    try {
      return await operation(token);
    } catch (error: any) {
      if (error.response?.status === 403 || error.response?.data?.errors?.[0]?.code === 'Unauthorized' || error.response?.data?.errors?.[0]?.message?.includes('Access to requested resource is denied')) {
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
          total_amount: o.OrderTotal?.Amount || 0,
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

      let shippingAddress = o.ShippingAddress;
      let buyerInfo = o.BuyerInfo;

      // Normalize buyer data
      const buyer = {
        id: buyerInfo?.BuyerEmail || 'anonymous',
        nickname: buyerInfo?.BuyerName || 'Comprador Amazon',
        name: buyerInfo?.BuyerName || 'Comprador Amazon',
        first_name: buyerInfo?.BuyerName?.split(' ')[0] || 'Comprador',
        last_name: buyerInfo?.BuyerName?.split(' ').slice(1).join(' ') || '',
        document: buyerInfo?.BuyerTaxInfo?.CompanyLegalName || '',
      };

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
        total_amount: o.OrderTotal?.Amount || 0,
        currency_id: o.OrderTotal?.CurrencyCode || 'BRL',
        buyer,
        items,
        original_data: o
      };
    }, 'getOrderDetails');
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
      unit_price: item.ItemPrice && item.ItemPrice.Amount ? (Number(item.ItemPrice.Amount) / item.QuantityOrdered) : 0,
      currency_id: item.ItemPrice ? item.ItemPrice.CurrencyCode : 'BRL',
      sku: item.SellerSKU,
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

  async updateProductImages(externalId: string, images: any[]): Promise<any> { throw new Error('Method not implemented.'); }
  async updateOrderStatus(orderId: string, status: string, token?: any): Promise<any> { throw new Error('Method not implemented.'); }
  async updateProductTitle(externalId: string, title: string): Promise<any> { throw new Error('Method not implemented.'); }
  async updateProductCategory(externalId: string, category: any): Promise<any> { throw new Error('Method not implemented.'); }
  async updateProductInventory(externalId: string, inventory: any): Promise<any> { throw new Error('Method not implemented.'); }
  async validateProduct(product: any): Promise<{ isValid: boolean; missingRequirements: string[]; }> {
    return { isValid: true, missingRequirements: [] };
  }
}

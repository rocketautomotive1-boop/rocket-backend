import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { StandardOrder } from '../../model/order.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { TikTokShopAuthAdapter } from './tiktok-shop-auth.adapter';
import { getTikTokShopBaseUrl, buildSignedParams, buildHeaders } from './tiktok-shop-utils';

@Injectable()
export class TikTokShopOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
  private readonly logger = new Logger(TikTokShopOrderAdapter.name);
  private readonly baseUrl = getTikTokShopBaseUrl();

  constructor(
    @Inject(forwardRef(() => MarketplaceAdapterRegistry))
    private readonly registry: MarketplaceAdapterRegistry,
    @Inject(forwardRef(() => TikTokShopAuthAdapter))
    private readonly authAdapter: TikTokShopAuthAdapter,
  ) {}

  onModuleInit() {
    this.registry.registerOrderAdapter('TikTok Shop', this);
    this.logger.log('TikTokShopOrderAdapter registered');
  }

  async getOrders(params: any): Promise<StandardOrder[]> {
    const token = await this.authAdapter.getValidToken('TikTok Shop');
    const shopCipher = token.additionalData?.shopCipher;

    const path = '/order/202309/orders/search';
    const timestamp = Math.floor(Date.now() / 1000);

    const body: any = {
      page_size: params.limit || 20,
    };

    if (params.status) {
      body.order_status = this.mapStatusToTikTok(params.status);
    }

    if (params.create_time_from) {
      body.create_time_from = Math.floor(new Date(params.create_time_from).getTime() / 1000);
    }
    if (params.create_time_to) {
      body.create_time_to = Math.floor(new Date(params.create_time_to).getTime() / 1000);
    }

    const bodyStr = JSON.stringify(body);
    const queryParams = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

    try {
      const response = await axios.post(`${this.baseUrl}${path}`, body, {
        headers: buildHeaders(token.accessToken),
        params: queryParams,
      });

      if (response.data?.code !== 0) {
        throw new Error(`TikTok Shop API Error: ${response.data?.message}`);
      }

      const orders = response.data?.data?.orders || [];
      return orders.map((order: any) => this.normalizeOrder(order));
    } catch (error: any) {
      this.logger.error(`Erro ao buscar pedidos do TikTok Shop: ${error.message}`);
      throw error;
    }
  }

  async getOrderDetails(orderId: string, token?: any): Promise<StandardOrder> {
    if (!token) {
      token = await this.authAdapter.getValidToken('TikTok Shop');
    }
    const shopCipher = token.additionalData?.shopCipher;

    const path = `/order/202309/orders`;
    const timestamp = Math.floor(Date.now() / 1000);
    const queryParams = buildSignedParams(path, timestamp, token.accessToken, shopCipher, {
      ids: orderId,
    });

    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        headers: buildHeaders(token.accessToken),
        params: queryParams,
      });

      if (response.data?.code !== 0) {
        throw new Error(`TikTok Shop API Error: ${response.data?.message}`);
      }

      const orders = response.data?.data?.orders || [];
      if (orders.length === 0) {
        throw new Error(`Pedido ${orderId} não encontrado no TikTok Shop`);
      }

      return this.normalizeOrder(orders[0]);
    } catch (error: any) {
      this.logger.error(`Erro ao buscar detalhes do pedido ${orderId}: ${error.message}`);
      throw error;
    }
  }

  async updateOrderStatus(orderId: string, status: string, token?: any): Promise<any> {
    if (!token) {
      token = await this.authAdapter.getValidToken('TikTok Shop');
    }
    const shopCipher = token.additionalData?.shopCipher;

    if (status === 'shipped' || status === 'ship') {
      return this.shipOrder(orderId, token, shopCipher);
    }

    this.logger.warn(`[TikTok Shop] Status update '${status}' not directly supported via API for order ${orderId}`);
    return { success: false, error: `Status '${status}' não suportado diretamente` };
  }

  async uploadInvoice(orderId: string, xmlContent: string, options?: { packId?: string; pdfBase64?: string }): Promise<any> {
    this.logger.warn(`[TikTok Shop] Invoice upload not yet supported for order ${orderId}`);
    return { success: false, error: 'Upload de NF-e não suportado pelo TikTok Shop' };
  }

  private async shipOrder(orderId: string, token: any, shopCipher?: string): Promise<any> {
    const path = `/fulfillment/202309/orders/${orderId}/packages`;
    const timestamp = Math.floor(Date.now() / 1000);

    const body = {
      pick_up: {},
    };

    const bodyStr = JSON.stringify(body);
    const params = buildSignedParams(path, timestamp, token.accessToken, shopCipher, undefined, bodyStr);

    const response = await axios.post(`${this.baseUrl}${path}`, body, {
      headers: buildHeaders(token.accessToken),
      params,
    });

    if (response.data?.code !== 0) {
      throw new Error(`TikTok Shop ship error: ${response.data?.message}`);
    }

    return { success: true, result: response.data };
  }

  private normalizeOrder(order: any): StandardOrder {
    const items = (order.line_items || []).map((item: any) => ({
      id: item.id || '',
      sku: item.seller_sku || '',
      title: item.product_name || '',
      quantity: item.quantity || 1,
      unit_price: Number(item.sale_price || 0) / 100,
      currency_id: 'BRL',
      original_data: item,
    }));

    const buyer = {
      id: order.buyer_uid || '',
      nickname: order.buyer_message ? 'buyer' : '',
      name: order.recipient_address?.name || '',
      phone: order.recipient_address?.phone_number || '',
      address: order.recipient_address
        ? {
            street: order.recipient_address.address_line1 || '',
            number: '',
            zip_code: order.recipient_address.postal_code || '',
            neighborhood: order.recipient_address.district || '',
            city: order.recipient_address.city || '',
            state: order.recipient_address.state || '',
            country: order.recipient_address.region_code || 'BR',
            complement: order.recipient_address.address_line2 || '',
          }
        : undefined,
    };

    const payments = (order.payment?.payment_methods || []).map((pm: any) => ({
      payment_method_id: pm.payment_method_name || '',
      transaction_amount: Number(pm.amount || 0) / 100,
    }));

    return {
      id: order.id || '',
      status: this.mapTikTokStatus(order.status),
      date_created: order.create_time ? new Date(order.create_time * 1000) : new Date(),
      total_amount: Number(order.payment?.total_amount || 0) / 100,
      currency_id: 'BRL',
      buyer,
      items,
      shipping: {
        id: order.tracking_number || '',
        cost: Number(order.payment?.shipping_fee || 0) / 100,
        status: order.status || '',
      },
      payments,
      original_data: order,
    } as any;
  }

  private mapStatusToTikTok(status: string): number {
    const statusMap: Record<string, number> = {
      unpaid: 100,
      on_hold: 105,
      awaiting_shipment: 111,
      awaiting_collection: 112,
      partially_shipping: 114,
      in_transit: 121,
      delivered: 122,
      completed: 130,
      cancelled: 140,
    };
    return statusMap[status] || 100;
  }

  private mapTikTokStatus(statusCode: number | string): string {
    const statusMap: Record<number, string> = {
      100: 'unpaid',
      105: 'on_hold',
      111: 'awaiting_shipment',
      112: 'awaiting_collection',
      114: 'partially_shipping',
      121: 'in_transit',
      122: 'delivered',
      130: 'completed',
      140: 'cancelled',
    };
    return statusMap[Number(statusCode)] || String(statusCode);
  }
}

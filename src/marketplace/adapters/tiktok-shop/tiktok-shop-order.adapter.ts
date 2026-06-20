import { Injectable, Logger, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { StandardOrder } from '../../model/order.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { TikTokShopHttpClient } from './tiktok-shop-http-client';

@Injectable()
export class TikTokShopOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
  private readonly logger = new Logger(TikTokShopOrderAdapter.name);

  constructor(
    @Inject(forwardRef(() => MarketplaceAdapterRegistry))
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly http: TikTokShopHttpClient,
  ) {}

  onModuleInit() {
    this.registry.registerOrderAdapter('TikTok Shop', this);
    this.logger.log('TikTokShopOrderAdapter registered');
  }

  async getOrders(params: any): Promise<StandardOrder[]> {
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

    try {
      const data = await this.http.post('/order/202309/orders/search', {
        context: 'getOrders',
        accountId: params?.accountId,
        domain: params?.domain,
      }, body);

      if (data?.code !== 0) {
        throw new Error(`TikTok Shop API Error: ${data?.message}`);
      }

      const orders = data?.data?.orders || [];
      return orders.map((order: any) => this.normalizeOrder(order));
    } catch (error: any) {
      this.logger.error(`Erro ao buscar pedidos do TikTok Shop: ${error.message}`);
      throw error;
    }
  }

  async getOrderDetails(orderId: string, accountId?: string): Promise<StandardOrder> {
    try {
      const data = await this.http.get('/order/202309/orders', {
        context: 'getOrderDetails',
        accountId,
      }, { ids: orderId });

      if (data?.code !== 0) {
        throw new Error(`TikTok Shop API Error: ${data?.message}`);
      }

      const orders = data?.data?.orders || [];
      if (orders.length === 0) {
        throw new Error(`Pedido ${orderId} não encontrado no TikTok Shop`);
      }

      return this.normalizeOrder(orders[0]);
    } catch (error: any) {
      this.logger.error(`Erro ao buscar detalhes do pedido ${orderId}: ${error.message}`);
      throw error;
    }
  }

  async updateOrderStatus(orderId: string, status: string, accountId?: string): Promise<any> {
    if (status === 'shipped' || status === 'ship') {
      return this.shipOrder(orderId, accountId);
    }

    this.logger.warn(`[TikTok Shop] Status update '${status}' not directly supported via API for order ${orderId}`);
    return { success: false, error: `Status '${status}' não suportado diretamente` };
  }

  async uploadInvoice(orderId: string, xmlContent: string, options?: { packId?: string; pdfBase64?: string }): Promise<any> {
    this.logger.warn(`[TikTok Shop] Invoice upload not yet supported for order ${orderId}`);
    return { success: false, error: 'Upload de NF-e não suportado pelo TikTok Shop' };
  }

  private async shipOrder(orderId: string, accountId?: string): Promise<any> {
    const data = await this.http.post(
      `/fulfillment/202309/orders/${orderId}/packages`,
      { context: 'shipOrder', accountId },
      { pick_up: {} },
    );

    if (data?.code !== 0) {
      throw new Error(`TikTok Shop ship error: ${data?.message}`);
    }

    return { success: true, result: data };
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

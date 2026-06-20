import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { ShopeeHttpClient } from './shopee-http-client';
import { HttpAuthContext } from '../shared/marketplace-http-client';
import { StandardOrder } from '../../model/order.interface';

const ORDER_DETAIL_FIELDS =
  'buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,goods_to_declare,note,pay_time,pickup_done_time,item_list,invoice_data,checkout_shipping_carrier,reverse_shipping_fee,order_chargeable_weight_gram,etc_check_field,payment_method,shipping_carrier';

@Injectable()
export class ShopeeOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
  private readonly logger = new Logger(ShopeeOrderAdapter.name);
  private name = 'Shopee';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly http: ShopeeHttpClient,
  ) { }

  onModuleInit() {
    this.registry.registerOrderAdapter(this.name, this);
  }

  /** Contexto de auth (conta default Shopee; shopId resolvido pelo HttpClient). */
  private ctx(context: string): HttpAuthContext {
    return { context };
  }

  async getOrders(params: any): Promise<StandardOrder[]> {
    this.logger.log(`ShopeeAdapter.getOrders called with params: ${JSON.stringify(params)}`);
    this.logger.log(`Buscando pedidos na Shopee`);

    const queryParams: any = {
      time_range_field: 'create_time',
      time_from: params.timeFrom || Math.floor(Date.now() / 1000) - 86400 * 15,
      time_to: params.timeTo || Math.floor(Date.now() / 1000),
      page_size: params.limit || 50,

      // Safe-guard: If offset is numeric (generic pagination), ignore it for Shopee (cursor-based) to ensure we at least get Page 1.
      // Shopee cursors are strings. Passing '50' is likely invalid.
      cursor: (typeof params.offset === 'number' && params.offset > 0) ? '' : (params.offset || ''),
    };

    if (params.status) {
      queryParams.order_status = this.mapOrderStatus(params.status);
    }

    this.logger.log(`Shopee Params Prepared: ${JSON.stringify(queryParams)}`);

    const listData = await this.http.get<any>('/order/get_order_list', this.ctx('getOrders'), queryParams);

    const orderListResponse = listData?.response;
    if (!orderListResponse || !orderListResponse.order_list || orderListResponse.order_list.length === 0) {
      this.logger.log(`Nenhum pedido encontrado na Shopee.`);
      return [];
    }

    const orderSns = orderListResponse.order_list.map((o: any) => o.order_sn).join(',');

    // Fetch Order Details (Batch)
    const detailsData = await this.http.get<any>('/order/get_order_detail', this.ctx('getOrders.details'), {
      order_sn_list: orderSns,
      response_optional_fields: ORDER_DETAIL_FIELDS,
    });

    const detailedOrders = detailsData?.response?.order_list || [];

    return (detailedOrders || []).map((o: any) => ({
      id: String(o.order_sn),
      marketplaceId: 3, // Shopee ID is 3
      marketplaceName: this.name,
      status: o.order_status,
      date_created: new Date(o.create_time * 1000).toISOString(),
      total_amount: o.total_amount || (o.item_list || []).reduce((sum: number, item: any) => sum + (item.model_discounted_price * item.model_quantity_purchased), 0),
      currency_id: o.currency,
      buyer: {
        id: String(o.buyer_user_id || 0),
        nickname: o.buyer_username,
        name: o.buyer_username,
      },
      items: (o.item_list || []).map((i: any) => ({
        id: String(i.item_id),
        sku: i.item_sku,
        title: i.item_name,
        quantity: i.model_quantity_purchased,
        unit_price: i.model_discounted_price,
        currency_id: o.currency
      })),
      original_data: o
    }));
  }

  async getOrderDetails(orderId: string): Promise<StandardOrder> {
    this.logger.log(`Buscando detalhes do pedido na Shopee: ${orderId}`);

    const data = await this.http.get<any>('/order/get_order_detail', this.ctx('getOrderDetails'), {
      order_sn_list: orderId,
      response_optional_fields: ORDER_DETAIL_FIELDS,
    });

    const o = data?.response?.order_list?.[0];
    if (!o) throw new Error('Pedido não encontrado na Shopee');

    return {
      id: String(o.order_sn),
      marketplaceId: 3, // Shopee ID is 3
      marketplaceName: this.name,
      status: o.order_status,
      date_created: new Date(o.create_time * 1000).toISOString(),
      total_amount: o.total_amount,
      currency_id: o.currency,
      buyer: {
        id: String(o.buyer_user_id || 0),
        nickname: o.buyer_username,
        name: o.buyer_username,
      },
      items: (o.item_list || []).map((i: any) => ({
        id: String(i.item_id),
        sku: i.item_sku,
        title: i.item_name,
        quantity: i.model_quantity_purchased,
        unit_price: i.model_discounted_price,
        currency_id: o.currency
      })),
      original_data: o
    };
  }

  async updateOrderStatus(orderId: string, status: string): Promise<any> {
    this.logger.log(`Atualizando status do pedido na Shopee: ${orderId} para ${status}`);

    const path = this.getOrderStatusUpdatePath(status);
    // shop_id já é injetado pelo HttpClient nos query params (assinatura Shopee).
    return this.http.post<any>(path, this.ctx('updateOrderStatus'), { order_sn: orderId });
  }

  private mapOrderStatus(status: string): string {
    const map = {
      pending: 'UNPAID',
      paid: 'READY_TO_SHIP',
      shipped: 'SHIPPED',
      delivered: 'COMPLETED',
      cancelled: 'CANCELLED',
    };

    return map[status] || status;
  }

  private getOrderStatusUpdatePath(status: string): string {
    const map = {
      shipped: '/logistics/ship_order',
      delivered: '/logistics/batch_ship_order',
      cancelled: '/order/cancel_order',
    };

    return map[status] || '/order/handle_buyer_cancellation';
  }
}

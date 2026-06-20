import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { getShopeeBaseUrl, buildHeaders } from './shopee-utils'
import { ShopeeSignerService } from './shopee-signer.service'
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { AuthRetryService } from '../shared/auth-retry.service';
import { ResolvedToken } from '../../auth/services/token-manager.service';
import { StandardOrder } from '../../model/order.interface';

@Injectable()
export class ShopeeOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
  private readonly logger = new Logger(ShopeeOrderAdapter.name);
  private baseUrl = getShopeeBaseUrl();
  private name = 'Shopee';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly signer: ShopeeSignerService,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly authRetry: AuthRetryService,
  ) { }

  onModuleInit() {
    this.registry.registerOrderAdapter(this.name, this);
  }

  private async executeWithRetry<T>(
    operation: (token: ResolvedToken) => Promise<T>,
    context: string,
  ): Promise<T> {
    const mkt = await this.marketplaceRegistry.findByName(this.name);
    return this.authRetry.run({ marketplaceId: String(mkt._id), context }, operation);
  }

  async getOrders(params: any): Promise<StandardOrder[]> {
    this.logger.log(`ShopeeAdapter.getOrders called with params: ${JSON.stringify(params)}`);
    return this.executeWithRetry(async (currentToken) => {
      this.logger.log(`Buscando pedidos na Shopee`);

      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/order/get_order_list';

      const queryParams: any = {
        time_range_field: 'create_time',
        time_from: params.timeFrom || Math.floor(Date.now() / 1000) - 86400 * 15,
        time_to: params.timeTo || Math.floor(Date.now() / 1000),
        page_size: params.limit || 50,

        // Safe-guard: If offset is numeric (generic pagination), ignore it for Shopee (cursor-based) to ensure we at least get Page 1.
        // Shopee cursors are strings. Passing '50' is likely invalid.
        cursor: (typeof params.offset === 'number' && params.offset > 0) ? '' : (params.offset || ''),
      };

      this.logger.log(`Shopee Params Prepared: ${JSON.stringify(queryParams)}`);

      if (params.status) {
        queryParams.order_status = this.mapOrderStatus(params.status);
      }

      const paramsSigned = await this.signer.buildSignedParams(path, timestamp, currentToken.accessToken, parseInt(currentToken.additionalData.shopId), queryParams);

      const response = await axios.get(`${this.baseUrl}${path}`, {
        headers: buildHeaders(currentToken.accessToken),
        params: paramsSigned,
      });

      const orderListResponse = response.data.response;
      if (!orderListResponse || !orderListResponse.order_list || orderListResponse.order_list.length === 0) {
        this.logger.log(`Nenhum pedido encontrado na Shopee.`);
        return [];
      }

      const orderSns = orderListResponse.order_list.map((o: any) => o.order_sn).join(',');

      // Fetch Order Details (Batch)
      const detailsPath = '/order/get_order_detail';
      const detailsTimestamp = Math.floor(Date.now() / 1000);

      const detailsSignedParams = await this.signer.buildSignedParams(detailsPath, detailsTimestamp, currentToken.accessToken, parseInt(currentToken.additionalData.shopId), {
        order_sn_list: orderSns,
        response_optional_fields: 'buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,goods_to_declare,note,pay_time,pickup_done_time,item_list,invoice_data,checkout_shipping_carrier,reverse_shipping_fee,order_chargeable_weight_gram,etc_check_field,payment_method,shipping_carrier'
      });

      const detailsResponse = await axios.get(`${this.baseUrl}${detailsPath}`, {
        headers: buildHeaders(currentToken.accessToken),
        params: detailsSignedParams
      });

      const detailedOrders = detailsResponse.data.response?.order_list || [];

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
    }, 'getOrders');
  }

  async getOrderDetails(orderId: string, token?: any): Promise<StandardOrder> {
    return this.executeWithRetry(async (currentToken) => {
      this.logger.log(`Buscando detalhes do pedido na Shopee: ${orderId}`);

      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/order/get_order_detail';
      const paramsSignedDetail = await this.signer.buildSignedParams(path, timestamp, currentToken.accessToken, currentToken.additionalData.shopId, {
        order_sn_list: orderId,
        response_optional_fields: 'buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,goods_to_declare,note,pay_time,pickup_done_time,item_list,invoice_data,checkout_shipping_carrier,reverse_shipping_fee,order_chargeable_weight_gram,etc_check_field,payment_method,shipping_carrier'
      })

      const response = await axios.get(`${this.baseUrl}${path}`, {
        headers: buildHeaders(currentToken.accessToken),
        params: paramsSignedDetail,
      });

      const o = response.data.response.order_list[0];
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
    }, 'getOrderDetails');
  }

  async updateOrderStatus(orderId: string, status: string, token?: any): Promise<any> {
    return this.executeWithRetry(async (currentToken) => {
      this.logger.log(`Atualizando status do pedido na Shopee: ${orderId} para ${status}`);

      const timestamp = Math.floor(Date.now() / 1000);
      const path = this.getOrderStatusUpdatePath(status);
      const paramsSignedUpdate = await this.signer.buildSignedParams(path, timestamp, currentToken.accessToken, currentToken.additionalData.shopId)

      const response = await axios.post(`${this.baseUrl}${path}`, {
        order_sn: orderId,
        shop_id: parseInt(currentToken.additionalData.shopId),
      }, {
        headers: buildHeaders(currentToken.accessToken),
        params: paramsSignedUpdate,
      });

      return response.data;
    }, 'updateOrderStatus');
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

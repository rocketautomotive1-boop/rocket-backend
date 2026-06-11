import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { getShopeeBaseUrl, buildHeaders } from './shopee-utils'
import { ShopeeAuthAdapter } from './shopee-auth.adapter'
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceSignerService } from '../../auth/services/marketplace-signer.service';
import { StandardOrder } from '../../model/order.interface';

@Injectable()
export class ShopeeOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
  private readonly logger = new Logger(ShopeeOrderAdapter.name);
  private baseUrl = getShopeeBaseUrl();
  private name = 'Shopee';

  constructor(
    private readonly auth: ShopeeAuthAdapter,
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly signer: MarketplaceSignerService,
  ) { }

  onModuleInit() {
    this.registry.registerOrderAdapter(this.name, this);
  }

  private async executeWithRetry<T>(
    operation: (token: any) => Promise<T>,
    context: string
  ): Promise<T> {
    const token = await this.auth.getValidToken(this.name);
    try {
      return await operation(token);
    } catch (error: any) {
      const isAuthError = (error?.response?.status === 403) ||
        (error?.response?.status === 401) ||
        /invalid_acce?ess_token|invalid_access_token|error_auth/i.test(String(error?.response?.data?.error || error?.message || '')) ||
        (error?.response?.data?.message && /Invalid access_token/i.test(error.response.data.message));

      if (isAuthError) {
        this.logger.warn(`Erro de autenticação na Shopee (${context}), tentando renovar token...`);
        try {
          const newToken = await this.auth.refreshToken(token);
          if (newToken) {
            this.logger.log(`Token renovado com sucesso para ${context}, tentando novamente...`);
            return await operation(newToken);
          }
        } catch (refreshError: any) {
          this.logger.error(`Falha ao renovar token durante retry (${context}): ${refreshError.message}`);
          throw error;
        }
      }
      throw error;
    }
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

      const { params: paramsSigned } = await this.signer.sign('shopee', { path, timestamp, accessToken: currentToken.accessToken, shopId: parseInt(currentToken.additionalData.shopId), extra: queryParams });

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

      const { params: detailsSignedParams } = await this.signer.sign('shopee', { path: detailsPath, timestamp: detailsTimestamp, accessToken: currentToken.accessToken, shopId: parseInt(currentToken.additionalData.shopId), extra: {
        order_sn_list: orderSns,
        response_optional_fields: 'buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,goods_to_declare,note,pay_time,pickup_done_time,item_list,invoice_data,checkout_shipping_carrier,reverse_shipping_fee,order_chargeable_weight_gram,etc_check_field,payment_method,shipping_carrier'
      } });

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
      const { params: paramsSignedDetail } = await this.signer.sign('shopee', { path, timestamp, accessToken: currentToken.accessToken, shopId: currentToken.additionalData.shopId, extra: {
        order_sn_list: orderId,
        response_optional_fields: 'buyer_user_id,buyer_username,estimated_shipping_fee,recipient_address,actual_shipping_fee,goods_to_declare,note,pay_time,pickup_done_time,item_list,invoice_data,checkout_shipping_carrier,reverse_shipping_fee,order_chargeable_weight_gram,etc_check_field,payment_method,shipping_carrier'
      } })

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
      const { params: paramsSignedUpdate } = await this.signer.sign('shopee', { path, timestamp, accessToken: currentToken.accessToken, shopId: currentToken.additionalData.shopId })

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

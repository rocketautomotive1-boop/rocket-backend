import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { MercadoLivreAuthAdapter } from './mercado-livre-auth.adapter';
import FormData = require('form-data');
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';

@Injectable()
export class MercadoLivreOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
  private readonly logger = new Logger(MercadoLivreOrderAdapter.name);
  private baseUrl = 'https://api.mercadolibre.com';
  private name = 'Mercado Livre';

  constructor(
    @Inject(forwardRef(() => MercadoLivreAuthAdapter))
    private readonly authAdapter: MercadoLivreAuthAdapter,
    private readonly registry: MarketplaceAdapterRegistry,
  ) { }

  onModuleInit() {
    this.registry.registerOrderAdapter(this.name, this);
  }

  private async executeWithRetry<T>(
    operation: (token: string) => Promise<T>,
    context: string
  ): Promise<T> {
    try {
      const token = await this.authAdapter.getValidToken(this.name);
      return await operation(token);
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.data?.message === 'invalid_token') {
        this.logger.warn(`Erro de autenticação no Mercado Livre (${context}), forçando renovação do token...`);
        try {
          const newToken = await this.authAdapter.forceRefreshAccessToken(this.name);
          this.logger.log(`Token renovado com sucesso para ${context}, tentando novamente...`);
          return await operation(newToken);
        } catch (refreshError: any) {
          this.logger.error(`Falha ao renovar token durante retry (${context}): ${refreshError.message}`);
          throw error;
        }
      }
      throw error;
    }
  }

  async getOrders(params: any): Promise<any[]> {
    return this.executeWithRetry(async (token) => {
      this.logger.log(`Buscando pedidos no Mercado Livre`);

      const user = await this.authAdapter.me(this.name);
      if (!user) {
        throw new Error('Usuário não encontrado');
      }

      const response = await axios.get(`${this.baseUrl}/orders/search`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        params: {
          seller: user.id,
          status: params.status || 'paid',
          sort: 'date_desc',
          limit: params.limit || 50,
          offset: params.offset || 0,
        },
      });

      this.logger.log(`${response.data.results.length} pedidos encontrados no Mercado Livre`);

      return response.data.results.map((o: any) => ({
        id: String(o.id),
        marketplaceId: null, // Context agnostic
        marketplaceName: this.name,
        status: o.status,
        date_created: o.date_created,
        total_amount: o.total_amount,
        currency_id: o.currency_id,
        buyer: {
          id: o.buyer.id,
          nickname: o.buyer.nickname,
          name: (o.buyer.first_name && o.buyer.last_name) ? `${o.buyer.first_name} ${o.buyer.last_name}` : o.buyer.nickname,
          first_name: o.buyer.first_name,
          last_name: o.buyer.last_name,
          document: o.buyer.billing_info?.doc_number
        },
        items: (o.order_items || []).map((i: any) => ({
          id: i.item.id,
          sku: i.item.seller_sku || i.item.id,
          title: i.item.title,
          quantity: i.quantity,
          unit_price: i.unit_price,
          currency_id: i.currency_id
        })),
        original_data: o
      }));
    }, 'getOrders');
  }

  async getOrderDetails(orderId: string): Promise<any> {
    return this.executeWithRetry(async (token) => {
      this.logger.log(`Buscando detalhes do pedido no Mercado Livre: ${orderId}`);

      const response = await axios.get(`${this.baseUrl}/orders/${orderId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      this.logger.log(`Detalhes do pedido ${orderId} obtidos com sucesso`);
      const o = response.data;
      return {
        id: String(o.id),
        marketplaceName: this.name,
        status: o.status,
        date_created: o.date_created,
        total_amount: o.total_amount,
        currency_id: o.currency_id,
        buyer: {
          id: o.buyer.id,
          nickname: o.buyer.nickname,
          name: (o.buyer.first_name && o.buyer.last_name) ? `${o.buyer.first_name} ${o.buyer.last_name}` : o.buyer.nickname,
          document: o.buyer.billing_info?.doc_number
        },
        items: (o.order_items || []).map((i: any) => ({
          id: i.item.id,
          sku: i.item.seller_sku || i.item.id,
          title: i.item.title,
          quantity: i.quantity,
          unit_price: i.unit_price,
          currency_id: i.currency_id
        })),
        original_data: o
      };
    }, 'getOrderDetails');
  }

  async getBillingInfo(billingId: string): Promise<any> {
    return this.executeWithRetry(async (token) => {
      this.logger.log(`Buscando dados de faturamento (billing info: ${billingId}) no Mercado Livre`);

      const response = await axios.get(`${this.baseUrl}/orders/billing-info/MLB/${billingId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      this.logger.log(`Billing Info ${billingId} obtido com sucesso`);
      return response.data;
    }, 'getBillingInfo');
  }

  async updateOrderStatus(orderId: string, status: string): Promise<any> {
    return this.executeWithRetry(async (token) => {
      this.logger.log(`Atualizando status do pedido no Mercado Livre: ${orderId} para ${status}`);

      const response = await axios.post(`${this.baseUrl}/orders/${orderId}/${this.mapOrderStatus(status)}`, {}, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      this.logger.log(`Status do pedido ${orderId} atualizado para ${status}`);
      return response.data;
    }, 'updateOrderStatus');
  }

  async uploadInvoice(orderId: string, xmlContent: string): Promise<any> {
    return this.executeWithRetry(async (token) => {
      this.logger.log(`Enviando NFe (XML) para o pedido no Mercado Livre: ${orderId}`);

      const form = new FormData();
      // Using 'nfe.xml' as filename is important for some multipart parsers to detect it as a file
      form.append('fiscal_document', xmlContent, 'nfe.xml');

      const response = await axios.post(`${this.baseUrl}/orders/${orderId}/fiscal_documents`, form, {
        headers: {
          'Authorization': `Bearer ${token}`,
          ...form.getHeaders(),
        },
      });

      this.logger.log(`NFe enviada com sucesso para o pedido ${orderId}`);
      return response.data;
    }, 'uploadInvoice');
  }

  private mapOrderStatus(status: string): string {
    const map = {
      shipped: 'ship',
      delivered: 'deliver',
      cancelled: 'cancel',
    };

    return map[status] || status;
  }
}

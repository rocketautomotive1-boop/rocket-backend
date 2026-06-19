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
    context: string,
    accountId?: string,
  ): Promise<T> {
    try {
      const token = await this.authAdapter.getValidToken(this.name, accountId ? { accountId } : undefined);
      return await operation(token);
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.data?.message === 'invalid_token') {
        this.logger.warn(`Erro de autenticação no Mercado Livre (${context}), forçando renovação do token...`);
        try {
          const newToken = await this.authAdapter.forceRefreshAccessToken(
            this.name,
            accountId ? { accountId } : undefined,
          );
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
    const accountId: string | undefined = params?.accountId;
    return this.executeWithRetry(async (token) => {
      this.logger.log(`Buscando pedidos no Mercado Livre`);

      const user = await this.authAdapter.me(this.name, accountId ? { accountId } : undefined);
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
    }, 'getOrders', accountId);
  }

  async getOrderDetails(orderId: string, accountId?: string): Promise<any> {
    return this.executeWithRetry(async (token) => {
      this.logger.log(`Buscando detalhes do pedido no Mercado Livre: ${orderId}`);

      const response = await axios.get(`${this.baseUrl}/orders/${orderId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      this.logger.log(`Detalhes do pedido ${orderId} obtidos com sucesso`);
      const o = response.data;

      // Resolve buyer shipping address if available
      let buyerAddress: any = undefined;
      if (o.shipping?.receiver_address || o.shipping?.id) {
        try {
          const shRes = await axios.get(`${this.baseUrl}/shipments/${o.shipping.id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          const ra = shRes.data?.receiver_address || {};
          buyerAddress = {
            street: ra.street_name || '',
            number: String(ra.street_number || ''),
            complement: ra.comment || '',
            neighborhood: ra.neighborhood?.name || '',
            city: ra.city?.name || '',
            state: ra.state?.id?.replace('BR-', '') || '',
            zip_code: ra.zip_code || '',
            country: 'BR',
          };
        } catch { /* ignore — address enrichment is best-effort */ }
      }

      const buyer = o.buyer || {};
      const buyerName = (buyer.first_name || buyer.last_name)
        ? `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim()
        : buyer.nickname || '';

      return {
        id: String(o.id),
        pack_id: o.pack_id ? String(o.pack_id) : null,
        marketplaceName: this.name,
        status: o.status,
        date_created: o.date_created,
        total_amount: o.total_amount,
        currency_id: o.currency_id,
        // Payment breakdown
        payments: (o.payments || []).map((p: any) => ({
          id: p.id,
          status: p.status,
          payment_method_id: p.payment_method_id,
          payment_type: p.payment_type,
          operation_type: p.operation_type,
          transaction_amount: p.transaction_amount,
          total_paid_amount: p.total_paid_amount,
          coupon_amount: p.coupon_amount || 0,
          taxes_amount: p.taxes_amount || 0,
          marketplace_fee: p.marketplace_fee || 0,
          net_received_amount: p.net_received_amount || 0,
          installments: p.installments || 1,
          authorization_code: p.authorization_code || '',
          date_approved: p.date_approved,
        })),
        buyer: {
          id: buyer.id,
          nickname: buyer.nickname,
          name: buyerName,
          first_name: buyer.first_name,
          last_name: buyer.last_name,
          document: buyer.billing_info?.doc_number || '',
          address: buyerAddress,
          // Preserve billing_info.id so enrichBillingData can call /orders/billing-info/MLB/{id}
          billing_info: buyer.billing_info?.id
            ? { id: String(buyer.billing_info.id) }
            : undefined,
        },
        shipping: {
          id: o.shipping?.id ? String(o.shipping.id) : undefined,
          cost: o.shipping?.cost || 0,
          status: o.shipping?.status || '',
        },
        items: (o.order_items || []).map((i: any) => ({
          id: i.item.id,
          sku: i.item.seller_sku || i.item.id,
          seller_custom_field: i.item.seller_custom_field || i.item.seller_sku || '',
          title: i.item.title,
          quantity: i.quantity,
          unit_price: i.unit_price,
          currency_id: i.currency_id,
        })),
        original_data: o,
      };
    }, 'getOrderDetails', accountId);
  }

  async getBillingInfo(billingId: string, accountId?: string): Promise<any> {
    return this.executeWithRetry(async (token) => {
      this.logger.log(`Buscando dados de faturamento (billing info: ${billingId}) no Mercado Livre`);

      const response = await axios.get(`${this.baseUrl}/orders/billing-info/MLB/${billingId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      this.logger.log(`Billing Info ${billingId} obtido com sucesso`);
      return response.data;
    }, 'getBillingInfo', accountId);
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

  /**
   * Upload NF-e fiscal document to Mercado Livre.
   *
   * Per ML docs (NF Flex / Turbo / ME1 / Drop-Off):
   *   POST /packs/{pack_id}/fiscal_documents    ← preferred when pack_id is available
   *   POST /orders/{order_id}/fiscal_documents  ← fallback
   *
   * Accepts XML alone, or PDF + XML (max 2 files, 1 MB each).
   */
  async uploadInvoice(orderId: string, xmlContent: string, options?: { packId?: string; pdfBase64?: string }): Promise<any> {
    return this.executeWithRetry(async (token) => {
      const packId = options?.packId;
      const resourcePath = packId
        ? `/packs/${packId}/fiscal_documents`
        : `/orders/${orderId}/fiscal_documents`;

      this.logger.log(`Enviando NFe para ML: ${resourcePath}`);

      const form = new FormData();

      // XML is required; filename must end in .xml so ML accepts it
      const xmlBuffer = Buffer.from(xmlContent, 'utf-8');
      form.append('fiscal_document', xmlBuffer, {
        filename: 'nota_fiscal.xml',
        contentType: 'application/xml',
        knownLength: xmlBuffer.length,
      });

      // Optional: attach PDF if provided
      if (options?.pdfBase64) {
        const pdfBuffer = Buffer.from(options.pdfBase64, 'base64');
        form.append('fiscal_document', pdfBuffer, {
          filename: 'nota_fiscal.pdf',
          contentType: 'application/pdf',
          knownLength: pdfBuffer.length,
        });
      }

      const response = await axios.post(`${this.baseUrl}${resourcePath}`, form, {
        headers: {
          'Authorization': `Bearer ${token}`,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
      });

      this.logger.log(`NFe enviada com sucesso: ${JSON.stringify(response.data)}`);
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

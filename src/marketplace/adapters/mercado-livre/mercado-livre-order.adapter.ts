import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import FormData = require('form-data');
import { IMarketplaceOrderAdapter } from '../../interfaces/marketplace-order-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MlHttpClient } from './ml-http-client';
import { HttpAuthContext } from '../shared/marketplace-http-client';

@Injectable()
export class MercadoLivreOrderAdapter implements IMarketplaceOrderAdapter, OnModuleInit {
  private readonly logger = new Logger(MercadoLivreOrderAdapter.name);
  private name = 'Mercado Livre';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly http: MlHttpClient,
  ) { }

  onModuleInit() {
    this.registry.registerOrderAdapter(this.name, this);
  }

  /** Contexto de auth (conta por accountId) p/ o HttpClient. */
  private ctx(context: string, accountId?: string): HttpAuthContext {
    return { context, accountId };
  }

  async getOrders(params: any): Promise<any[]> {
    const accountId: string | undefined = params?.accountId;
    this.logger.log(`Buscando pedidos no Mercado Livre`);

    const user = await this.http.get<any>('/users/me', this.ctx('getOrders.me', accountId));
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    // ML cap: /orders/search rejeita limit>51 (400 limit.maximum_exceeded). Mantemos ≤ 50.
    const limit = Math.min(params.limit || 50, 50);

    // Delta incremental: quando o chamador passa `since` (cursor do reconciler), filtramos no
    // SERVIDOR via order.date_last_updated.from + sort date_asc — o ML devolve só o delta,
    // sem baixar o histórico. Sem `since`, mantém o comportamento legado (página recente desc).
    const since: Date | string | undefined = params.since;
    const query: Record<string, any> = {
      seller: user.id,
      status: params.status || 'paid',
      limit,
      offset: params.offset || 0,
    };
    if (since) {
      query.sort = 'date_asc';
      query['order.date_last_updated.from'] =
        since instanceof Date ? since.toISOString() : String(since);
    } else {
      query.sort = 'date_desc';
    }

    const data = await this.http.get<any>('/orders/search', this.ctx('getOrders', accountId), query);

    this.logger.log(`${data.results.length} pedidos encontrados no Mercado Livre`);

    return data.results.map((o: any) => ({
        id: String(o.id),
        marketplaceId: null, // Context agnostic
        marketplaceName: this.name,
        status: o.status,
        date_created: o.date_created,
        date_last_updated: o.date_last_updated,
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
  }

  async getOrderDetails(orderId: string, accountId?: string): Promise<any> {
    this.logger.log(`Buscando detalhes do pedido no Mercado Livre: ${orderId}`);
    const ctx = this.ctx('getOrderDetails', accountId);

    const o = await this.http.get<any>(`/orders/${orderId}`, ctx);
    this.logger.log(`Detalhes do pedido ${orderId} obtidos com sucesso`);

    {
      // Resolve buyer shipping address if available
      let buyerAddress: any = undefined;
      if (o.shipping?.receiver_address || o.shipping?.id) {
        try {
          const ra = (await this.http.get<any>(`/shipments/${o.shipping.id}`, ctx))?.receiver_address || {};
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
    }
  }

  async getBillingInfo(billingId: string, accountId?: string): Promise<any> {
    this.logger.log(`Buscando dados de faturamento (billing info: ${billingId}) no Mercado Livre`);
    const data = await this.http.get<any>(
      `/orders/billing-info/MLB/${billingId}`,
      this.ctx('getBillingInfo', accountId),
    );
    this.logger.log(`Billing Info ${billingId} obtido com sucesso`);
    return data;
  }

  async updateOrderStatus(orderId: string, status: string, accountId?: string): Promise<any> {
    this.logger.log(`Atualizando status do pedido no Mercado Livre: ${orderId} para ${status}`);
    const data = await this.http.post<any>(
      `/orders/${orderId}/${this.mapOrderStatus(status)}`,
      this.ctx('updateOrderStatus', accountId),
      {},
    );
    this.logger.log(`Status do pedido ${orderId} atualizado para ${status}`);
    return data;
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
  async uploadInvoice(orderId: string, xmlContent: string, options?: { packId?: string; pdfBase64?: string; accountId?: string }): Promise<any> {
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

    const res = await this.http.request<any>(
      {
        method: 'POST',
        path: resourcePath,
        body: form,
        headers: form.getHeaders(),
        axiosConfig: { maxBodyLength: Infinity },
      },
      this.ctx('uploadInvoice', options?.accountId),
    );

    this.logger.log(`NFe enviada com sucesso: ${JSON.stringify(res.data)}`);
    return res.data;
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

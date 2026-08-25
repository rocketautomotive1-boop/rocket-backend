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
      // status/substatus de envio vêm do MESMO GET /shipments/{id} que já fazemos para o
      // endereço — o substatus (shipped/out_for_delivery/delivered/...) não existe no objeto
      // raso `o.shipping`. Capturamos aqui sem custo de API extra.
      let shipmentStatus: string | undefined;
      let shipmentSubstatus: string | undefined;
      let shipmentTracking: string | undefined;
      let shipmentScheduledShippingDate: string | undefined;
      if (o.shipping?.receiver_address || o.shipping?.id) {
        try {
          const shipment = (await this.http.get<any>(`/shipments/${o.shipping.id}`, ctx)) || {};
          shipmentStatus = shipment.status || undefined;
          shipmentSubstatus = shipment.substatus || undefined;
          shipmentTracking = shipment.tracking_number || undefined;
          // Envio Programado — ML preenche estimated_schedule_delivery_date quando o
          // comprador agenda uma data de entrega. Só usamos se ainda estiver no futuro
          // (data passada não trava mais nada).
          const scheduleDate = shipment.shipping_option?.estimated_schedule_delivery_date?.date;
          shipmentScheduledShippingDate = scheduleDate && new Date(scheduleDate) > new Date()
            ? scheduleDate
            : undefined;
          const ra = shipment.receiver_address || {};
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
          status: shipmentStatus || o.shipping?.status || '',
          substatus: shipmentSubstatus,
          trackingCode: shipmentTracking,
          scheduledShippingDate: shipmentScheduledShippingDate,
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
   * Envia a NFe ao Mercado Livre — a rota certa depende do logistic_type do
   * envio, então resolvemos isso primeiro:
   *
   * - fulfillment/cross_docking/xd_drop_off/drop_off/xd_same_day: ML REJEITA
   *   (403 "you must use the biller of MercadoLibre") o upload via
   *   /packs/{pack_id}/fiscal_documents para esses tipos — é preciso "importar"
   *   a nota via POST /shipments/{id}/invoice_data/?siteId=MLB, com o XML cru
   *   (Content-Type: application/xml), não multipart. Essa importação destrava
   *   o substatus invoice_pending do envio (necessário pra imprimir etiqueta),
   *   diferente do endpoint de pack, que só disponibiliza o doc ao comprador.
   *   Ver docs.mercadolivre.com.br/pt_br/nf-places-crossdocking-xdsameday.
   * - demais tipos (Flex/Turbo/ME1 clássico): endpoint de pack, como antes.
   */
  private static readonly INVOICE_DATA_LOGISTIC_TYPES = new Set([
    'fulfillment', 'cross_docking', 'xd_drop_off', 'drop_off', 'xd_same_day',
  ]);

  async uploadInvoice(orderId: string, xmlContent: string, options?: { packId?: string; pdfBase64?: string; accountId?: string }): Promise<any> {
    const ctx = this.ctx('uploadInvoice', options?.accountId);
    const shipment = await this.resolveShipment(orderId, ctx);

    if (shipment && MercadoLivreOrderAdapter.INVOICE_DATA_LOGISTIC_TYPES.has(shipment.logisticType)) {
      return this.importShipmentInvoice(shipment.shipmentId, xmlContent, ctx);
    }
    return this.uploadPackInvoice(orderId, xmlContent, options, ctx);
  }

  /** Busca shipmentId + logistic_type do envio deste pedido; null se o pedido não
   *  tiver shipping ou a busca falhar — nesse caso, cai no fluxo de pack (padrão
   *  anterior a esta mudança, sempre foi o único fluxo suportado). */
  private async resolveShipment(orderId: string, ctx: HttpAuthContext): Promise<{ shipmentId: string; logisticType: string } | null> {
    try {
      const order = await this.http.get<any>(`/orders/${orderId}`, ctx);
      const shipmentId = order?.shipping?.id;
      if (!shipmentId) return null;
      const shipment = await this.http.get<any>(`/shipments/${shipmentId}`, ctx);
      const logisticType = shipment?.logistic_type ?? shipment?.logistic?.type;
      return logisticType ? { shipmentId: String(shipmentId), logisticType } : null;
    } catch (err: any) {
      this.logger.warn(`Não foi possível resolver o envio do pedido ${orderId}: ${err.message}`);
      return null;
    }
  }

  /** POST /shipments/{id}/invoice_data — importação de NFe para envios
   *  fulfillment/cross_docking/xd_drop_off/drop_off/xd_same_day. */
  private async importShipmentInvoice(shipmentId: string, xmlContent: string, ctx: HttpAuthContext): Promise<any> {
    this.logger.log(`Importando NFe via invoice_data: /shipments/${shipmentId}/invoice_data`);
    const res = await this.http.request<any>(
      {
        method: 'POST',
        path: `/shipments/${shipmentId}/invoice_data`,
        query: { siteId: 'MLB' },
        body: xmlContent,
        headers: { 'Content-Type': 'application/xml' },
      },
      ctx,
    );
    this.logger.log(`NFe importada com sucesso via invoice_data: ${JSON.stringify(res.data)}`);
    return res.data;
  }

  /** POST /packs/{pack_id}/fiscal_documents (ou /orders/{id}/fiscal_documents sem
   *  pack_id) — anexa a NFe ao pacote (fluxo clássico Flex/Turbo/ME1). Aceita XML
   *  isolado ou XML+PDF (máx. 2 arquivos, 1 MB cada). */
  private async uploadPackInvoice(
    orderId: string,
    xmlContent: string,
    options: { packId?: string; pdfBase64?: string } | undefined,
    ctx: HttpAuthContext,
  ): Promise<any> {
    const packId = options?.packId;
    const resourcePath = packId
      ? `/packs/${packId}/fiscal_documents`
      : `/orders/${orderId}/fiscal_documents`;

    this.logger.log(`Enviando NFe para ML: ${resourcePath}`);

    // FormData (form-data) é um stream de uso único — se AuthRetryService
    // renovar o token e retentar, ou o rate-limit retry reagir a um 429, a
    // mesma instância já está drenada e o request trava até o socket cair
    // (nenhum dado, nenhum erro). buildForm() é passado como factory para que
    // MarketplaceHttpClient gere um FormData novo em cada tentativa.
    const buildForm = () => {
      const form = new FormData();
      const xmlBuffer = Buffer.from(xmlContent, 'utf-8');
      form.append('fiscal_document', xmlBuffer, {
        filename: 'nota_fiscal.xml',
        contentType: 'application/xml',
        knownLength: xmlBuffer.length,
      });
      if (options?.pdfBase64) {
        const pdfBuffer = Buffer.from(options.pdfBase64, 'base64');
        form.append('fiscal_document', pdfBuffer, {
          filename: 'nota_fiscal.pdf',
          contentType: 'application/pdf',
          knownLength: pdfBuffer.length,
        });
      }
      return form;
    };

    const res = await this.http.request<any>(
      {
        method: 'POST',
        path: resourcePath,
        body: buildForm,
        axiosConfig: { maxBodyLength: Infinity },
      },
      ctx,
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

import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';

/** Tópicos portfolio_* (ciclo de vida assíncrono de SKU/preço/estoque) que viram kind:'listing_status'. */
const PORTFOLIO_TOPICS = new Set(['portfolios_sku', 'portfolios_price', 'portfolios_stock']);

@Injectable()
@RegisterWebhookAdapter('magalu')
export class MagaluAdapter implements WebhookAdapter {
  readonly marketplace = 'magalu';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-magalu-signature', secretKey:'webhookSecret', baseString:'rawBody' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    if (topic === 'orders') {
      const id = ctx.payload?.data?.id ?? ctx.payload?.order_id;
      const externalId = id !== undefined && id !== null ? String(id) : '';
      return { kind:'order', eventId:`magalu:orders:${externalId}`, externalId, raw:ctx.payload };
    }
    if (PORTFOLIO_TOPICS.has(topic)) {
      // sku vem em data.params.sku (ver doc de webhooks: resource=/seller/v1/portfolios/skus/{sku}).
      // No Magalu esse sku É o nosso productId (endpoint idempotente por sku) — o listener resolve
      // o Listing por (marketplace, productId) direto, sem precisar de externalId gravado antes.
      const sku = ctx.payload?.data?.params?.sku;
      const externalId = sku !== undefined && sku !== null ? String(sku) : '';
      const status = ctx.payload?.data?.status ?? 'unknown';
      return {
        kind: externalId ? 'listing_status' : 'ignore',
        eventId: `magalu:${topic}:${externalId}:${status}`,
        externalId,
        resource: ctx.payload?.data?.resource,
        raw: ctx.payload,
      };
    }
    return { kind:'ignore', eventId:`magalu:${topic}`, raw:ctx.payload };
  }
}

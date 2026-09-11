import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';

/** Tópicos portfolio_* (ciclo de vida assíncrono de SKU/preço/estoque) que viram kind:'listing_status'. */
const PORTFOLIO_TOPICS = new Set(['portfolios_sku', 'portfolios_price', 'portfolios_stock']);

@Injectable()
@RegisterWebhookAdapter('magalu')
export class MagaluAdapter implements WebhookAdapter {
  readonly marketplace = 'magalu';
  /**
   * Confirmado na doc oficial de webhooks (signup v1) — NÃO é HMAC simples sobre
   * o rawBody como os demais marketplaces: header é `X-Signature-256` no formato
   * `sha256=<hex>` (SignatureVerifier já trata o prefixo/múltiplas assinaturas em
   * rotação de secret), e a base assinada é `{timestamp}.{body}` — o timestamp vem
   * de um header IRMÃO (`X-Timestamp`), não do payload. `secretKey: 'webhookSecret'`
   * guarda o `secret` (formato `whsec_*`) devolvido pelo PUT /v1/onboarding/signup —
   * exibido só uma vez na criação.
   */
  readonly signatureScheme: SignatureScheme = {
    type: 'hmac-sha256',
    header: 'x-signature-256',
    secretKey: 'webhookSecret',
    baseString: (ctx) => `${ctx.headers['x-timestamp'] ?? ''}.${ctx.rawBody?.toString('utf8') ?? ''}`,
  };
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

import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
const ORDER_TOPICS = new Set(['order.created','order.updated','order.shipped','order.delivered','order.cancelled']);
@Injectable()
@RegisterWebhookAdapter('viavarejo')
export class ViaVarejoAdapter implements WebhookAdapter {
  readonly marketplace = 'viavarejo';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-viavarejo-signature', secretKey:'webhookSecret', baseString:'rawBody' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    if (!ORDER_TOPICS.has(topic)) return { kind:'ignore', eventId:`viavarejo:${topic}`, raw:ctx.payload };
    const id = ctx.payload?.data?.id;
    const externalId = id !== undefined && id !== null ? String(id) : '';
    return { kind:'order', eventId:`viavarejo:${topic}:${externalId}`, externalId, raw:ctx.payload };
  }
}

import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
const lastSeg = (r: string) => r.split('/').filter(Boolean).pop() ?? '';
@Injectable()
@RegisterWebhookAdapter('mercadolivre')
export class MercadoLivreAdapter implements WebhookAdapter {
  readonly marketplace = 'mercadolivre';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-signature', secretKey:'webhookSecret', baseString:'rawBody' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    const resource = String(ctx.payload?.resource||'');
    if (resource.startsWith('/packs/')) return { kind:'order_pack', eventId:`mercadolivre:packs:${resource}`, externalId:lastSeg(resource), resource, raw:ctx.payload };
    if (topic==='orders_v2'||resource.startsWith('/orders/')) return { kind:'order', eventId:`mercadolivre:orders_v2:${resource}`, externalId:lastSeg(resource), resource, raw:ctx.payload };
    if (topic==='questions'||resource.startsWith('/questions/')) return { kind:'question', eventId:`mercadolivre:questions:${resource}`, externalId:lastSeg(resource), resource, raw:ctx.payload };
    return { kind:'ignore', eventId:`mercadolivre:${topic}:${resource}`, resource, raw:ctx.payload };
  }
}

import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
@Injectable()
@RegisterWebhookAdapter('b2w')
export class B2WAdapter implements WebhookAdapter {
  readonly marketplace = 'b2w';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-hub-signature', secretKey:'webhookSecret', baseString:'rawBody' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    if (topic!=='orders') return { kind:'ignore', eventId:`b2w:${topic}`, raw:ctx.payload };
    const id = ctx.payload?.data?.id ?? ctx.payload?.order?.id;
    const externalId = id !== undefined && id !== null ? String(id) : '';
    return { kind:'order', eventId:`b2w:orders:${externalId}`, externalId, raw:ctx.payload };
  }
}

import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
@Injectable()
@RegisterWebhookAdapter('magalu')
export class MagaluAdapter implements WebhookAdapter {
  readonly marketplace = 'magalu';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-magalu-signature', secretKey:'webhookSecret', baseString:'rawBody' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    if (topic!=='orders') return { kind:'ignore', eventId:`magalu:${topic}`, raw:ctx.payload };
    const id = ctx.payload?.data?.id ?? ctx.payload?.order_id;
    const externalId = id !== undefined && id !== null ? String(id) : '';
    return { kind:'order', eventId:`magalu:orders:${externalId}`, externalId, raw:ctx.payload };
  }
}

import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
@Injectable()
@RegisterWebhookAdapter('aliexpress')
export class AliExpressAdapter implements WebhookAdapter {
  readonly marketplace = 'aliexpress';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-acs-signature', secretKey:'webhookSecret', baseString:'rawBody' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    if (topic!=='trade') return { kind:'ignore', eventId:`aliexpress:${topic}`, raw:ctx.payload };
    const id = ctx.payload?.data?.order_id;
    const externalId = id !== undefined && id !== null ? String(id) : '';
    return { kind:'order', eventId:`aliexpress:trade:${externalId}`, externalId, raw:ctx.payload };
  }
}

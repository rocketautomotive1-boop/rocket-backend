import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
@Injectable()
@RegisterWebhookAdapter('yampi')
export class YampiAdapter implements WebhookAdapter {
  readonly marketplace = 'yampi';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-yampi-hmac-sha256', secretKey:'webhookSecret', baseString:'rawBody' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    if (topic!=='order') return { kind:'ignore', eventId:`yampi:${topic}`, raw:ctx.payload };
    const id = ctx.payload?.data?.id ?? ctx.payload?.resource?.id;
    const externalId = id !== undefined && id !== null ? String(id) : '';
    return { kind:'order', eventId:`yampi:order:${externalId}`, externalId, raw:ctx.payload };
  }
}

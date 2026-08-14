import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
@Injectable()
@RegisterWebhookAdapter('olx')
export class OLXAdapter implements WebhookAdapter {
  readonly marketplace = 'olx';
  readonly signatureScheme: SignatureScheme = { type:'shared-token', header:'x-webhook-token', secretKey:'webhookToken' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    const resource = String(ctx.payload?.resource||'');
    return { kind:'ignore', eventId:`olx:${topic}:${resource}`, resource, raw:ctx.payload };
  }
}

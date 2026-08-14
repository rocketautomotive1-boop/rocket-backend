import { Injectable } from '@nestjs/common';
import * as axios from 'axios';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
@Injectable()
@RegisterWebhookAdapter('amazon')
export class AmazonAdapter implements WebhookAdapter {
  readonly marketplace = 'amazon';
  readonly signatureScheme: SignatureScheme = { type:'aws-sns' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    if (ctx.payload?.Type === 'SubscriptionConfirmation') return { kind:'ignore', eventId:`amazon:subscription-confirmation`, raw:ctx.payload };
    if (topic!=='order-notification') return { kind:'ignore', eventId:`amazon:${topic}`, raw:ctx.payload };
    let inner: any = undefined;
    if (typeof ctx.payload?.Message === 'string') { try { inner = JSON.parse(ctx.payload.Message); } catch { inner = undefined; } }
    const externalId = String(inner?.AmazonOrderId ?? ctx.payload?.AmazonOrderId ?? ctx.payload?.orderId ?? '');
    return { kind:'order', eventId:`amazon:order:${externalId}`, externalId, raw:ctx.payload };
  }
  async confirmSubscription(subscribeUrl: string): Promise<void> {
    await axios.default.get(subscribeUrl);
  }
}

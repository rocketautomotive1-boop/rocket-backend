import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
@Injectable()
@RegisterWebhookAdapter('tiktokshop')
export class TikTokShopAdapter implements WebhookAdapter {
  readonly marketplace = 'tiktokshop';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-tts-signature', secretKey:'webhookSecret', baseString:'rawBody' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    return { kind:'ignore', eventId:`tiktokshop:${topic}`, raw:ctx.payload };
  }
}

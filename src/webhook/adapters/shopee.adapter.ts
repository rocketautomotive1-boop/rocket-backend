import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
@Injectable()
@RegisterWebhookAdapter('shopee')
export class ShopeeAdapter implements WebhookAdapter {
  readonly marketplace = 'shopee';
  readonly signatureScheme: SignatureScheme = { type:'hmac-sha256', header:'x-shopee-signature', secretKey:'partnerKey', baseString:(ctx)=>`${ctx.payload?.partner_id ?? ''}${ctx.rawBody?.toString('utf8') ?? JSON.stringify(ctx.payload)}` };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    if (topic!=='order') return { kind:'ignore', eventId:`shopee:${topic}`, raw:ctx.payload };
    const sn = ctx.payload?.data?.ordersn || ctx.payload?.data?.order_sn || '';
    return { kind:'order', eventId:`shopee:order:${sn}`, externalId:String(sn), raw:ctx.payload };
  }
}

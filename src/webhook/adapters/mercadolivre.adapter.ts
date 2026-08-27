import { Injectable } from '@nestjs/common';
import { NormalizedWebhook, RegisterWebhookAdapter, SignatureScheme, WebhookAdapter, WebhookContext } from './webhook-adapter.interface';
const lastSeg = (r: string) => r.split('/').filter(Boolean).pop() ?? '';
@Injectable()
@RegisterWebhookAdapter('mercadolivre')
export class MercadoLivreAdapter implements WebhookAdapter {
  readonly marketplace = 'mercadolivre';
  // ML webhooks de tópico (items/orders_v2/questions/stock-locations) NÃO são assinados:
  // não enviam x-signature nem x-request-id (confirmado via captura do rawBody real). A
  // verificação de origem é feita downstream ao buscar o `resource` na API com o token da
  // conta dona — só o seller legítimo consegue lê-lo. (x-signature ts/v1 é do Mercado PAGO,
  // não dos webhooks de tópico do ML.)
  readonly signatureScheme: SignatureScheme = { type: 'none' };
  parse(ctx: WebhookContext): NormalizedWebhook {
    const topic = String(ctx.topic||'').toLowerCase();
    const resource = String(ctx.payload?.resource||'');
    // user_id do ML = seller destino da notificação → resolve a conta multi-client.
    const externalUserId = ctx.payload?.user_id != null ? String(ctx.payload.user_id) : undefined;
    if (resource.startsWith('/packs/')) return { kind:'order_pack', eventId:`mercadolivre:packs:${resource}`, externalId:lastSeg(resource), resource, externalUserId, raw:ctx.payload };
    if (topic==='orders_v2'||resource.startsWith('/orders/')) return { kind:'order', eventId:`mercadolivre:orders_v2:${resource}`, externalId:lastSeg(resource), resource, externalUserId, raw:ctx.payload };
    // `shipments` = mudança de status/substatus do envio (impresso, postado, coletado, em
    // trânsito, entregue...) que NÃO dispara `orders_v2` correlato de forma confiável — sem
    // isso, shipping.status/substatus fica congelado na última sync (confirmado em produção:
    // pedido travado ~24h em 'invoice_pending' enquanto o shipment real já tinha avançado 7
    // estados). `resource` é `/shipments/{shipment_id}` — não é o id do pedido; o listener
    // resolve pedido↔shipment via API antes de reingerir.
    if (topic==='shipments'||resource.startsWith('/shipments/')) return { kind:'shipment', eventId:`mercadolivre:shipments:${resource}`, externalId:lastSeg(resource), resource, externalUserId, raw:ctx.payload };
    if (topic==='questions'||resource.startsWith('/questions/')) return { kind:'question', eventId:`mercadolivre:questions:${resource}`, externalId:lastSeg(resource), resource, externalUserId, raw:ctx.payload };
    // `items` is the only signal ML gives for moderation (no `moderations` topic exists): a
    // moderated listing changes sub_status → fires `items`. Treat it as a low-latency probe;
    // the moderation module checks /infractions for this item (no-op if there's none).
    if (topic==='items'||resource.startsWith('/items/')) return { kind:'moderation', eventId:`mercadolivre:items:${resource}`, externalId:lastSeg(resource), resource, externalUserId, raw:ctx.payload };
    // `claims` = reclamação/devolução pós-venda. O resource é /post-purchase/v1/claims/{id};
    // o listener resolve a conta dona e busca o claim na API (só o seller legítimo o lê).
    if (topic==='claims'||resource.includes('/claims/')) return { kind:'return', eventId:`mercadolivre:claims:${resource}`, externalId:lastSeg(resource), resource, externalUserId, raw:ctx.payload };
    return { kind:'ignore', eventId:`mercadolivre:${topic}:${resource}`, resource, externalUserId, raw:ctx.payload };
  }
}

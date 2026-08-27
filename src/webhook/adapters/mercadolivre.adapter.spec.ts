import { MercadoLivreAdapter } from './mercadolivre.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic: string, payload: any): WebhookContext => ({ marketplace:'mercadolivre', topic, headers:{}, payload, rawBody: Buffer.from(JSON.stringify(payload)) });
describe('MercadoLivreAdapter.parse', () => {
  const sut = new MercadoLivreAdapter();
  it('order /orders/123', () => { const n = sut.parse(ctx('orders_v2',{resource:'/orders/123',user_id:9})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('123'); expect(n.eventId).toBe('mercadolivre:orders_v2:/orders/123'); });
  it('pack /packs/55', () => { const n = sut.parse(ctx('orders_v2',{resource:'/packs/55'})); expect(n.kind).toBe('order_pack'); expect(n.externalId).toBe('55'); });
  it('shipments /shipments/47856425023 (mudança de status/substatus de envio)', () => { const n = sut.parse(ctx('shipments',{resource:'/shipments/47856425023',user_id:9})); expect(n.kind).toBe('shipment'); expect(n.externalId).toBe('47856425023'); expect(n.externalUserId).toBe('9'); expect(n.eventId).toBe('mercadolivre:shipments:/shipments/47856425023'); });
  it('question', () => { const n = sut.parse(ctx('questions',{resource:'/questions/77'})); expect(n.kind).toBe('question'); expect(n.externalId).toBe('77'); });
  it('items → moderation probe (no `moderations` topic exists at ML)', () => { const n = sut.parse(ctx('items',{resource:'/items/MLB1',user_id:9})); expect(n.kind).toBe('moderation'); expect(n.externalId).toBe('MLB1'); expect(n.externalUserId).toBe('9'); });
  it('claims → return (devolução/reclamação pós-venda)', () => { const n = sut.parse(ctx('claims',{resource:'/post-purchase/v1/claims/13608375358',user_id:9})); expect(n.kind).toBe('return'); expect(n.externalId).toBe('13608375358'); expect(n.externalUserId).toBe('9'); expect(n.eventId).toBe('mercadolivre:claims:/post-purchase/v1/claims/13608375358'); });
  it('unknown topic → ignore', () => { expect(sut.parse(ctx('payments',{resource:'/payments/1'})).kind).toBe('ignore'); });
  it('scheme none (ML webhooks de tópico não são assinados)', () => { expect(sut.signatureScheme).toEqual({ type:'none' }); });
});

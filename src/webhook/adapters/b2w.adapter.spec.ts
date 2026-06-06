import { B2WAdapter } from './b2w.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'b2w', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('B2WAdapter.parse', () => {
  const sut = new B2WAdapter();
  it('order data.id', () => { const n = sut.parse(ctx('orders',{data:{id:'B1'}})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('B1'); expect(n.eventId).toBe('b2w:orders:B1'); });
  it('order fallback order.id', () => { expect(sut.parse(ctx('orders',{order:{id:'B2'}})).externalId).toBe('B2'); });
  it('unrelated → ignore', () => { expect(sut.parse(ctx('items',{})).kind).toBe('ignore'); });
  it('scheme hmac', () => { expect(sut.signatureScheme.type).toBe('hmac-sha256'); });
});

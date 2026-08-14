import { MagaluAdapter } from './magalu.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'magalu', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('MagaluAdapter.parse', () => {
  const sut = new MagaluAdapter();
  it('order data.id', () => { const n = sut.parse(ctx('orders',{data:{id:'M1'}})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('M1'); expect(n.eventId).toBe('magalu:orders:M1'); });
  it('order fallback order_id', () => { expect(sut.parse(ctx('orders',{order_id:'M2'})).externalId).toBe('M2'); });
  it('unrelated → ignore', () => { expect(sut.parse(ctx('items',{})).kind).toBe('ignore'); });
  it('scheme hmac', () => { expect(sut.signatureScheme.type).toBe('hmac-sha256'); });
});

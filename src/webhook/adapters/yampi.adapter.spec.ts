import { YampiAdapter } from './yampi.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'yampi', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('YampiAdapter.parse', () => {
  const sut = new YampiAdapter();
  it('order data.id', () => { const n = sut.parse(ctx('order',{data:{id:'Y1'}})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('Y1'); expect(n.eventId).toBe('yampi:order:Y1'); });
  it('order fallback resource.id', () => { expect(sut.parse(ctx('order',{resource:{id:'Y2'}})).externalId).toBe('Y2'); });
  it('unrelated → ignore', () => { expect(sut.parse(ctx('cart',{})).kind).toBe('ignore'); });
  it('scheme hmac', () => { expect(sut.signatureScheme.type).toBe('hmac-sha256'); });
});

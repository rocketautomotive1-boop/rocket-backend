import { ViaVarejoAdapter } from './viavarejo.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'viavarejo', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('ViaVarejoAdapter.parse', () => {
  const sut = new ViaVarejoAdapter();
  it('order.created', () => { const n = sut.parse(ctx('order.created',{data:{id:'V1'}})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('V1'); expect(n.eventId).toBe('viavarejo:order.created:V1'); });
  it('order.cancelled uppercase normalized', () => { const n = sut.parse(ctx('ORDER.CANCELLED',{data:{id:'V2'}})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('V2'); });
  it('unrelated → ignore', () => { expect(sut.parse(ctx('product.created',{})).kind).toBe('ignore'); });
  it('scheme hmac', () => { expect(sut.signatureScheme.type).toBe('hmac-sha256'); });
});

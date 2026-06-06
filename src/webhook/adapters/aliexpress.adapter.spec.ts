import { AliExpressAdapter } from './aliexpress.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'aliexpress', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('AliExpressAdapter.parse', () => {
  const sut = new AliExpressAdapter();
  it('trade order', () => { const n = sut.parse(ctx('trade',{data:{order_id:'A1'}})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('A1'); expect(n.eventId).toBe('aliexpress:trade:A1'); });
  it('unrelated → ignore', () => { expect(sut.parse(ctx('product',{})).kind).toBe('ignore'); });
  it('scheme hmac', () => { expect(sut.signatureScheme.type).toBe('hmac-sha256'); });
});

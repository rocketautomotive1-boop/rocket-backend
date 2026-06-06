import { OLXAdapter } from './olx.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'olx', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('OLXAdapter.parse', () => {
  const sut = new OLXAdapter();
  it('any topic → ignore', () => { const n = sut.parse(ctx('order',{resource:'/orders/O1'})); expect(n.kind).toBe('ignore'); expect(n.eventId).toBe('olx:order:/orders/O1'); });
  it('unrelated → ignore', () => { expect(sut.parse(ctx('lead',{})).kind).toBe('ignore'); });
  it('scheme none', () => { expect(sut.signatureScheme.type).toBe('none'); });
});

import { TikTokShopAdapter } from './tiktokshop.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'tiktokshop', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('TikTokShopAdapter.parse', () => {
  const sut = new TikTokShopAdapter();
  it('order topic → ignore (none mapped)', () => { const n = sut.parse(ctx('order',{})); expect(n.kind).toBe('ignore'); expect(n.eventId).toBe('tiktokshop:order'); });
  it('unrelated → ignore', () => { expect(sut.parse(ctx('item',{})).kind).toBe('ignore'); });
  it('scheme hmac', () => { expect(sut.signatureScheme.type).toBe('hmac-sha256'); });
});

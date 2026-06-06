import { ShopeeAdapter } from './shopee.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'shopee', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('ShopeeAdapter.parse', () => {
  const sut = new ShopeeAdapter();
  it('order ordersn', () => { const n = sut.parse(ctx('order',{data:{ordersn:'SN123'},partner_id:7})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('SN123'); expect(n.eventId).toBe('shopee:order:SN123'); });
  it('order_sn alternativo', () => { expect(sut.parse(ctx('order',{data:{order_sn:'SN9'}})).externalId).toBe('SN9'); });
  it('não-order → ignore', () => { expect(sut.parse(ctx('item',{})).kind).toBe('ignore'); });
  it('scheme hmac', () => { expect(sut.signatureScheme.type).toBe('hmac-sha256'); });
});

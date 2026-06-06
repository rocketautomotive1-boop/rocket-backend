import { WebhookInboxService } from './webhook-inbox.service';
import { NormalizedWebhook } from '../adapters/webhook-adapter.interface';
const normalized: NormalizedWebhook = { kind:'order', eventId:'mercadolivre:orders_v2:/orders/1', externalId:'1', resource:'/orders/1', raw:{resource:'/orders/1'} };
describe('WebhookInboxService.append', () => {
  it('cria registro novo (isNew true)', async () => {
    const created = { _id:'x', eventId: normalized.eventId };
    const model:any = { create: jest.fn().mockResolvedValue(created), findOne: jest.fn() };
    const sut = new WebhookInboxService(model);
    const r = await sut.append('mercadolivre','orders_v2',normalized);
    expect(r.isNew).toBe(true); expect(r.record).toBe(created);
  });
  it('duplicado (11000) → isNew false, retorna existente', async () => {
    const existing = { _id:'y', eventId: normalized.eventId };
    const model:any = { create: jest.fn().mockRejectedValue({ code:11000 }), findOne: jest.fn().mockReturnValue({ exec: ()=>Promise.resolve(existing) }) };
    const sut = new WebhookInboxService(model);
    const r = await sut.append('mercadolivre','orders_v2',normalized);
    expect(r.isNew).toBe(false); expect(r.record).toBe(existing);
  });
});

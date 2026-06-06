import { WebhookController } from './webhook.controller';
describe('WebhookController', () => {
  it('chama ingress.ingest com adapter e context do request', async () => {
    const ingress = { ingest: jest.fn().mockResolvedValue({ success:true }) };
    const sut = new WebhookController(ingress as any);
    const req:any = { webhookAdapter:{ marketplace:'mercadolivre' }, webhookContext:{ marketplace:'mercadolivre' } };
    const r = await sut.handle('mercadolivre','orders_v2', req);
    expect(ingress.ingest).toHaveBeenCalledWith(req.webhookAdapter, req.webhookContext);
    expect(r).toEqual({ success:true });
  });
});

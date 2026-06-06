import { WebhookIngressService } from './webhook-ingress.service';
const makeSut = () => {
  const inbox = { append: jest.fn().mockResolvedValue({ record:{_id:'r'}, isNew:true }), appendDead: jest.fn().mockResolvedValue(undefined) };
  const metrics = { incReceived: jest.fn() };
  return { sut: new WebhookIngressService(inbox as any, metrics as any), inbox, metrics };
};
const ctxFor = (parseImpl:any, payload:any={}) => ({
  webhookContext: { marketplace:'mercadolivre', topic:'orders_v2', headers:{}, payload, rawBody:Buffer.from('{}') },
  webhookAdapter: { marketplace:'mercadolivre', parse: parseImpl },
});
describe('WebhookIngressService.ingest', () => {
  it('kind ignore → não persiste', async () => {
    const { sut, inbox } = makeSut();
    const { webhookContext, webhookAdapter } = ctxFor(()=>({ kind:'ignore', eventId:'x', raw:{} }));
    const r = await sut.ingest(webhookAdapter as any, webhookContext as any);
    expect(inbox.append).not.toHaveBeenCalled(); expect(r.success).toBe(true);
  });
  it('kind order → persiste + métrica', async () => {
    const { sut, inbox, metrics } = makeSut();
    const { webhookContext, webhookAdapter } = ctxFor(()=>({ kind:'order', eventId:'mercadolivre:orders_v2:/orders/1', externalId:'1', resource:'/orders/1', raw:{} }));
    await sut.ingest(webhookAdapter as any, webhookContext as any);
    expect(inbox.append).toHaveBeenCalled(); expect(metrics.incReceived).toHaveBeenCalledWith('mercadolivre','order');
  });
  it('parse lança → appendDead + ack', async () => {
    const { sut, inbox } = makeSut();
    const { webhookContext, webhookAdapter } = ctxFor(()=>{ throw new Error('payload ruim'); });
    const r = await sut.ingest(webhookAdapter as any, webhookContext as any);
    expect(inbox.appendDead).toHaveBeenCalled(); expect(r.success).toBe(true);
  });
  it('Amazon SubscriptionConfirmation → confirma e não persiste', async () => {
    const { sut, inbox } = makeSut();
    const confirm = jest.fn().mockResolvedValue(undefined);
    const ctx = { marketplace:'amazon', topic:'t', headers:{}, payload:{ Type:'SubscriptionConfirmation', SubscribeURL:'https://x' }, rawBody:Buffer.from('{}') };
    const adapter = { marketplace:'amazon', parse: ()=>({ kind:'ignore', eventId:'a', raw:{} }), confirmSubscription: confirm };
    const r = await sut.ingest(adapter as any, ctx as any);
    expect(confirm).toHaveBeenCalledWith('https://x'); expect(inbox.append).not.toHaveBeenCalled(); expect(r.success).toBe(true);
  });
});

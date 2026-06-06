import { WebhookInboxWorker } from './webhook-inbox.worker';

const makeSut = (dispatcherThrows = false, attempts = 0, maxAttempts = 8) => {
  const entry = { _id:'e1', marketplace:'mercadolivre', topic:'orders_v2', kind:'order',
    eventId:'id1', externalId:'1', resource:'/orders/1', payload:{resource:'/orders/1'},
    receivedAt:new Date(), attempts, maxAttempts };
  const model:any = {
    find: jest.fn().mockReturnValue({ sort: ()=>({ limit: ()=>({ lean: ()=>({ exec: ()=>Promise.resolve([entry]) }) }) }) }),
    findOneAndUpdate: jest.fn().mockResolvedValue(entry),
    findByIdAndUpdate: jest.fn().mockResolvedValue(undefined),
  };
  const dispatcher = { dispatch: dispatcherThrows ? jest.fn().mockRejectedValue(new Error('boom')) : jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn((k:string,f?:any)=>f) };
  const metrics = { incDead: jest.fn() };
  return { worker: new WebhookInboxWorker(model, dispatcher as any, config as any, metrics as any), model, dispatcher, metrics };
};

describe('WebhookInboxWorker', () => {
  it('claim grava owner + leaseUntil', async () => {
    const { worker, model } = makeSut();
    await worker.processPending();
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id:'e1' }),
      expect.objectContaining({ status:'processing', owner: expect.any(String), leaseUntil: expect.any(Date) }),
      expect.anything(),
    );
  });
  it('sucesso → done', async () => {
    const { worker, model } = makeSut(false);
    await worker.processPending();
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ status:'done' }));
  });
  it('falha com tentativas restantes → pending + backoff', async () => {
    const { worker, model } = makeSut(true, 0, 8);
    await worker.processPending();
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ status:'pending', attempts:1 }));
  });
  it('falha esgotando tentativas → dead + métrica', async () => {
    const { worker, model, metrics } = makeSut(true, 7, 8);
    await worker.processPending();
    expect(model.findByIdAndUpdate).toHaveBeenCalledWith('e1', expect.objectContaining({ status:'dead' }));
    expect(metrics.incDead).toHaveBeenCalledWith('mercadolivre','order');
  });
});

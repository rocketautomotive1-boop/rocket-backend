import { OrchestratorPublisherService } from './orchestrator-publisher.service';

describe('OrchestratorPublisherService', () => {
  function makeSut() {
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const sut = new OrchestratorPublisherService(outbox as any);
    return { sut, outbox };
  }

  it('requestSync grava no outbox com exchange/routingKey corretos', async () => {
    const { sut, outbox } = makeSut();
    await sut.requestSync({ productId: 'p1', reason: 'user_publish' });
    expect(outbox.enqueue).toHaveBeenCalledWith(
      { exchange: 'rocket.orchestrator', routingKey: 'product.sync.requested', payload: { productId: 'p1', reason: 'user_publish' } },
      { session: undefined },
    );
  });

  it('requestSync propaga a session quando fornecida', async () => {
    const { sut, outbox } = makeSut();
    const fakeSession = {} as any;
    await sut.requestSync({ productId: 'p2', reason: 'stock_deduction' }, fakeSession);
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.any(Object), { session: fakeSession });
  });
});

import { OutboxRelayService } from './outbox-relay.service';

describe('OutboxRelayService', () => {
  const makeMsg = (over: any = {}) => ({
    _id: 'id1', exchange: 'ex', routingKey: 'rk', payload: { productId: 'p1' }, attempts: 0, ...over,
  });

  function makeSut(over: { publishImpl?: () => Promise<any> } = {}) {
    const repo = {
      claimBatch: jest.fn().mockResolvedValue([makeMsg()]),
      markPublished: jest.fn().mockResolvedValue(undefined),
      markFailedOrReschedule: jest.fn().mockResolvedValue(undefined),
      recoverStalePublishing: jest.fn().mockResolvedValue(0),
    };
    const amqp = { publish: jest.fn(over.publishImpl ? over.publishImpl : () => Promise.resolve(true)) };
    const sut = new OutboxRelayService(repo as any, amqp as any);
    return { sut, repo, amqp };
  }

  it('publica com persistent:true e marca published após confirm', async () => {
    const { sut, repo, amqp } = makeSut();
    await (sut as any).drainOnce();
    expect(amqp.publish).toHaveBeenCalledWith('ex', 'rk', { productId: 'p1' }, { persistent: true });
    expect(repo.markPublished).toHaveBeenCalledWith('id1');
    expect(repo.markFailedOrReschedule).not.toHaveBeenCalled();
  });

  it('em falha de publish, reagenda com backoff e NÃO marca published', async () => {
    const { sut, repo } = makeSut({ publishImpl: () => Promise.reject(new Error('broker down')) });
    await (sut as any).drainOnce();
    expect(repo.markPublished).not.toHaveBeenCalled();
    expect(repo.markFailedOrReschedule).toHaveBeenCalledWith('id1', 0, expect.stringContaining('broker down'), expect.any(Number));
  });

  it('nada claimado ⇒ não publica', async () => {
    const { sut, repo, amqp } = makeSut();
    repo.claimBatch.mockResolvedValueOnce([]);
    await (sut as any).drainOnce();
    expect(amqp.publish).not.toHaveBeenCalled();
  });
});

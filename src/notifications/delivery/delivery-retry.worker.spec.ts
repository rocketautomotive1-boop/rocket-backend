import { DeliveryRetryWorker } from './delivery-retry.worker';

const MAX_ATTEMPTS = 5;

function makeDoc(channel: string, attempts: number) {
  return {
    _id: 'n1', category: 'order', type: 't', title: 'T', body: 'B',
    severity: 'info', data: {}, createdAt: new Date(),
    audienceUserIds: ['u1'],
    delivery: [{ channel, status: 'failed', attempts, nextRetryAt: new Date(Date.now() - 1000) }],
  };
}

describe('DeliveryRetryWorker', () => {
  it('reprocessa canal retriable elegível e marca sent em sucesso', async () => {
    const doc = makeDoc('push', 1);
    const model = { find: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([doc]) }) }) } as any;
    const push = { key: 'push', retriable: true, send: jest.fn().mockResolvedValue(undefined) };
    const registry = { get: () => push } as any;
    const audience = { resolve: jest.fn().mockResolvedValue([{ userId: 'u1', pushTokens: ['t1'] }]) } as any;
    const status = { markSent: jest.fn(), markFailed: jest.fn() } as any;
    await new DeliveryRetryWorker(model, registry, audience, status).tick();
    expect(push.send).toHaveBeenCalled();
    expect(status.markSent).toHaveBeenCalledWith('n1', 'push');
  });

  it('não reprocessa quando atingiu o teto de tentativas', async () => {
    const doc = makeDoc('push', MAX_ATTEMPTS);
    const model = { find: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([doc]) }) }) } as any;
    const push = { key: 'push', retriable: true, send: jest.fn() };
    const registry = { get: () => push } as any;
    const status = { markSent: jest.fn(), markFailed: jest.fn() } as any;
    const audience = { resolve: jest.fn().mockResolvedValue([]) } as any;
    await new DeliveryRetryWorker(model, registry, audience, status).tick();
    expect(push.send).not.toHaveBeenCalled();
  });

  it('a query filtra status=failed, retriable e nextRetryAt vencido', async () => {
    const model = { find: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) }) } as any;
    await new DeliveryRetryWorker(model, { get: () => undefined } as any, {} as any, {} as any).tick();
    const filter = model.find.mock.calls[0][0];
    expect(filter['delivery'].$elemMatch.status).toBe('failed');
    expect(filter['delivery'].$elemMatch.nextRetryAt.$lte).toBeInstanceOf(Date);
  });
});

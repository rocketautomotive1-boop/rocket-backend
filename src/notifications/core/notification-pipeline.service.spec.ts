import { NotificationPipelineService } from './notification-pipeline.service';

function makeDeps(opts: { duplicate?: boolean; channels?: Record<string, any> } = {}) {
  const created = { _id: 'n1', toObject: () => ({}), createdAt: new Date() };
  const model = {
    create: jest.fn().mockResolvedValue(created),
  } as any;
  const dedup = { isDuplicate: jest.fn().mockResolvedValue(!!opts.duplicate) };
  const audience = { resolve: jest.fn().mockResolvedValue([{ userId: 'u1', pushTokens: ['t1'] }]) };
  const registry = {
    get: (k: string) => (opts.channels ?? {})[k],
  };
  const status = { markSent: jest.fn(), markFailed: jest.fn() };
  const svc = new NotificationPipelineService(
    model, dedup as any, audience as any, registry as any, status as any,
  );
  return { svc, model, dedup, audience, registry, status, created };
}

const baseReq = {
  type: 'order.processed', aggregateType: 'order' as const, aggregateId: '1',
  title: 'T', body: 'B',
};

describe('NotificationPipelineService', () => {
  it('descarta duplicatas sem persistir', async () => {
    const { svc, model } = makeDeps({ duplicate: true });
    await svc.handle(baseReq);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('persiste antes do fan-out (persist-first)', async () => {
    const calls: string[] = [];
    const push = { key: 'push', retriable: true, send: jest.fn(async () => calls.push('push')) };
    const { svc, model } = makeDeps({ channels: { push } });
    model.create.mockImplementation(async () => { calls.push('persist'); return { _id: 'n1', createdAt: new Date() }; });
    await svc.handle({ ...baseReq, channels: ['persist', 'push'] });
    expect(calls[0]).toBe('persist');
    expect(calls).toContain('push');
  });

  it('falha de um canal não impede os demais; marca failed', async () => {
    const push = { key: 'push', retriable: true, send: jest.fn().mockRejectedValue(new Error('boom')) };
    const ws = { key: 'websocket', retriable: false, send: jest.fn().mockResolvedValue(undefined) };
    const { svc, status } = makeDeps({ channels: { push, websocket: ws } });
    await svc.handle({ ...baseReq, channels: ['push', 'websocket'] });
    expect(ws.send).toHaveBeenCalled();
    expect(status.markFailed).toHaveBeenCalledWith('n1', 'push', 'boom', true);
    expect(status.markSent).toHaveBeenCalledWith('n1', 'websocket');
  });

  it('ignora o pseudo-canal persist no fan-out', async () => {
    const { svc, registry } = makeDeps();
    const spy = jest.spyOn(registry, 'get');
    await svc.handle({ ...baseReq, channels: ['persist'] });
    expect(spy).not.toHaveBeenCalledWith('persist');
  });
});

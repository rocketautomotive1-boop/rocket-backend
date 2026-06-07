import { NotificationDedupService } from './notification-dedup.service';

function makeModel(existing: boolean) {
  return {
    findOne: jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(existing ? { _id: 'x' } : null) }),
    }),
  } as any;
}

describe('NotificationDedupService', () => {
  it('retorna true quando existe doc recente com a mesma key', async () => {
    const svc = new NotificationDedupService(makeModel(true));
    await expect(svc.isDuplicate('k1')).resolves.toBe(true);
  });

  it('retorna false quando não existe', async () => {
    const svc = new NotificationDedupService(makeModel(false));
    await expect(svc.isDuplicate('k1')).resolves.toBe(false);
  });

  it('consulta com janela de 5 minutos', async () => {
    const model = makeModel(false);
    const svc = new NotificationDedupService(model);
    await svc.isDuplicate('k1');
    const filter = model.findOne.mock.calls[0][0];
    expect(filter.deduplicationKey).toBe('k1');
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    const deltaMs = Date.now() - filter.createdAt.$gte.getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(299_000);
    expect(deltaMs).toBeLessThanOrEqual(301_000);
  });
});

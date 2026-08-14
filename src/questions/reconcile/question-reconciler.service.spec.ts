import { Types } from 'mongoose';
import { QuestionReconciler } from './question-reconciler.service';
import { QUESTION_RECONCILE } from './question-reconcile-cursor';

const mlMarketplace = { _id: new Types.ObjectId(), enabled: true, name: 'Mercado Livre' };

/** Minimal in-memory checkpoint model standing in for the Mongoose model. */
function makeCheckpointModel(seed: any[] = []) {
  const docs = [...seed];
  return {
    docs,
    findOne: jest.fn((q: any) =>
      Promise.resolve(
        docs.find(
          (d) =>
            String(d.marketplaceId) === String(q.marketplaceId) &&
            String(d.accountId ?? null) === String(q.accountId ?? null),
        ) ?? null,
      ),
    ),
    create: jest.fn((doc: any) => {
      const created = { ...doc, save: jest.fn() };
      created.save.mockImplementation(() => Promise.resolve(created));
      docs.push(created);
      return Promise.resolve(created);
    }),
  };
}

function makeSut(opts: {
  accounts?: Array<{ accountId: string; label: string }>;
  delta?: Record<string, any[]>; // keyed by accountId ('default' for none)
  seed?: any[];
}) {
  const { accounts = [], delta = {}, seed = [] } = opts;

  const registry = { findAll: jest.fn().mockResolvedValue([mlMarketplace]) };
  const broker = {
    listAccountsWithToken: jest.fn().mockResolvedValue(accounts),
    ensureValidTokenByAccount: jest.fn((_m: string, accountId: string) =>
      Promise.resolve({ accessToken: `tok-${accountId}`, additionalData: { userId: `seller-${accountId}` } }),
    ),
    ensureValidToken: jest.fn().mockResolvedValue({ accessToken: 'tok-default', additionalData: { userId: 'seller-default' } }),
  };
  const adapter = {
    listQuestionsSince: jest.fn((sellerId: string) => {
      const key = sellerId.replace('seller-', '');
      return Promise.resolve(delta[key] ?? []);
    }),
  };
  const ingest = { ingest: jest.fn().mockResolvedValue(undefined) };
  const checkpointModel = makeCheckpointModel(seed);

  const sut = new QuestionReconciler(
    registry as any,
    broker as any,
    adapter as any,
    ingest as any,
    checkpointModel as any,
  );
  return { sut, broker, adapter, ingest, checkpointModel };
}

describe('QuestionReconciler', () => {
  it('scans every account with its own token and seller id', async () => {
    const { sut, broker, adapter } = makeSut({
      accounts: [
        { accountId: 'A', label: 'Loja A' },
        { accountId: 'B', label: 'Loja B' },
      ],
    });
    await sut.runOnce();
    expect(broker.ensureValidTokenByAccount).toHaveBeenCalledWith(String(mlMarketplace._id), 'A');
    expect(broker.ensureValidTokenByAccount).toHaveBeenCalledWith(String(mlMarketplace._id), 'B');
    expect(adapter.listQuestionsSince).toHaveBeenCalledWith('seller-A', expect.any(Date), 'A');
    expect(adapter.listQuestionsSince).toHaveBeenCalledWith('seller-B', expect.any(Date), 'B');
  });

  it('propagates accountId into ingest for each delta question', async () => {
    const { sut, ingest } = makeSut({
      accounts: [{ accountId: 'B', label: 'Loja B' }],
      delta: { B: [{ id: '77', item_id: 'MLB1', status: 'UNANSWERED', date_created: '2026-06-18T00:00:00Z' }] },
    });
    await sut.runOnce();
    expect(ingest.ingest).toHaveBeenCalledWith('77', 'reconcile', 'B');
  });

  it('falls back to the default account when none are registered', async () => {
    const { sut, broker, adapter, ingest } = makeSut({
      accounts: [],
      delta: { default: [{ id: '5', item_id: 'MLB9', status: 'UNANSWERED', date_created: '2026-06-18T00:00:00Z' }] },
    });
    await sut.runOnce();
    expect(broker.ensureValidToken).toHaveBeenCalledWith(String(mlMarketplace._id));
    expect(adapter.listQuestionsSince).toHaveBeenCalledWith('seller-default', expect.any(Date), undefined);
    expect(ingest.ingest).toHaveBeenCalledWith('5', 'reconcile', undefined);
  });

  it('keeps a separate cursor per account', async () => {
    const { sut, checkpointModel } = makeSut({
      accounts: [
        { accountId: 'A', label: 'Loja A' },
        { accountId: 'B', label: 'Loja B' },
      ],
      delta: { A: [{ id: '1', item_id: 'i', status: 'UNANSWERED', date_created: '2026-06-18T10:00:00Z' }] },
    });
    await sut.runOnce();
    const a = checkpointModel.docs.find((d: any) => d.accountId === 'A');
    const b = checkpointModel.docs.find((d: any) => d.accountId === 'B');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(new Date(a.lastCreatedCursor).toISOString()).toBe('2026-06-18T10:00:00.000Z');
  });

  it('advances the interval toward the ceiling on a clean run', async () => {
    const { sut, checkpointModel } = makeSut({
      accounts: [{ accountId: 'A', label: 'Loja A' }],
      delta: { A: [] },
    });
    await sut.runOnce();
    const a = checkpointModel.docs.find((d: any) => d.accountId === 'A');
    expect(a.currentIntervalMs).toBe(QUESTION_RECONCILE.FLOOR_MS * 2);
    expect(a.consecutiveCleanRuns).toBe(1);
  });

  it('skips an account whose interval has not elapsed yet', async () => {
    const future = new Date(Date.now() - 1000); // ran 1s ago, interval 5min
    const { sut, adapter } = makeSut({
      accounts: [{ accountId: 'A', label: 'Loja A' }],
      seed: [
        {
          marketplaceId: String(mlMarketplace._id),
          accountId: 'A',
          lastCreatedCursor: new Date('2026-06-01T00:00:00Z'),
          lastRunAt: future,
          consecutiveCleanRuns: 0,
          currentIntervalMs: QUESTION_RECONCILE.FLOOR_MS,
          save: jest.fn(),
        },
      ],
    });
    await sut.runOnce();
    expect(adapter.listQuestionsSince).not.toHaveBeenCalled();
  });

  it('isolates a failing account from the others', async () => {
    const { sut, broker, ingest } = makeSut({
      accounts: [
        { accountId: 'A', label: 'Loja A' },
        { accountId: 'B', label: 'Loja B' },
      ],
      delta: { B: [{ id: '9', item_id: 'i', status: 'UNANSWERED', date_created: '2026-06-18T00:00:00Z' }] },
    });
    broker.ensureValidTokenByAccount.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    await sut.runOnce();
    // A failed; B still processed.
    expect(ingest.ingest).toHaveBeenCalledWith('9', 'reconcile', 'B');
  });
});

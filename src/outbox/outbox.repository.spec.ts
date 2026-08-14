import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, Connection, Model } from 'mongoose';
import { OutboxMessage, OutboxMessageSchema, OutboxMessageDocument } from './schemas/outbox-message.schema';
import { OutboxRepository } from './outbox.repository';

describe('OutboxRepository', () => {
  let replset: MongoMemoryReplSet;
  let conn: Connection;
  let model: Model<OutboxMessageDocument>;
  let repo: OutboxRepository;

  beforeAll(async () => {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const m = await connect(replset.getUri());
    conn = m.connection;
    model = conn.model(OutboxMessage.name, OutboxMessageSchema) as any;
    repo = new OutboxRepository(model);
    // Create the collection and build indexes (incl. the TTL partial index) UP FRONT.
    // Otherwise the first write lazily mutates the catalog, which races a concurrent
    // multi-document transaction → MongoServerError "catalog changes; please retry".
    await model.createCollection();
    await model.init();
  });

  afterAll(async () => {
    await conn.close();
    await replset.stop();
  });

  beforeEach(async () => { await model.deleteMany({}); });

  it('enqueue persiste mensagem pending', async () => {
    await repo.enqueue({ exchange: 'ex', routingKey: 'rk', payload: { productId: 'p1' } });
    const docs = await model.find({});
    expect(docs).toHaveLength(1);
    expect(docs[0].status).toBe('pending');
    expect(docs[0].payload.productId).toBe('p1');
  });

  it('enqueue dentro de TX que ABORTA não persiste (atomicidade)', async () => {
    const session = await conn.startSession();
    session.startTransaction();
    await repo.enqueue({ exchange: 'ex', routingKey: 'rk', payload: { productId: 'p2' } }, { session });
    await session.abortTransaction();
    await session.endSession();
    expect(await model.countDocuments({})).toBe(0);
  });

  it('enqueue dentro de TX que COMMITA persiste', async () => {
    const session = await conn.startSession();
    session.startTransaction();
    await repo.enqueue({ exchange: 'ex', routingKey: 'rk', payload: { productId: 'p3' } }, { session });
    await session.commitTransaction();
    await session.endSession();
    expect(await model.countDocuments({})).toBe(1);
  });

  it('claimBatch reivindica pending vencidos e marca publishing com claimId', async () => {
    await model.create([
      { exchange: 'ex', routingKey: 'rk', payload: {}, status: 'pending', scheduledAt: new Date(Date.now() - 1000) },
      { exchange: 'ex', routingKey: 'rk', payload: {}, status: 'pending', scheduledAt: new Date(Date.now() - 1000) },
      { exchange: 'ex', routingKey: 'rk', payload: {}, status: 'pending', scheduledAt: new Date(Date.now() + 60000) },
    ]);
    const claimed = await repo.claimBatch(10, new Date());
    expect(claimed).toHaveLength(2);
    expect(claimed.every(c => c.status === 'publishing' && c.claimId)).toBe(true);
  });

  it('claimBatch concorrente não entrega o mesmo doc duas vezes', async () => {
    await model.create({ exchange: 'ex', routingKey: 'rk', payload: {}, status: 'pending', scheduledAt: new Date(Date.now() - 1000) });
    const [a, b] = await Promise.all([repo.claimBatch(10, new Date()), repo.claimBatch(10, new Date())]);
    expect(a.length + b.length).toBe(1);
  });

  it('markPublished marca published com publishedAt', async () => {
    const [doc] = await model.create([{ exchange: 'ex', routingKey: 'rk', payload: {}, status: 'publishing' }]);
    await repo.markPublished(String(doc._id));
    const after = await model.findById(doc._id);
    expect(after!.status).toBe('published');
    expect(after!.publishedAt).toBeTruthy();
  });

  it('markFailedOrReschedule reagenda enquanto attempts < maxAttempts', async () => {
    const [doc] = await model.create([{ exchange: 'ex', routingKey: 'rk', payload: {}, status: 'publishing', attempts: 0, maxAttempts: 8 }]);
    await repo.markFailedOrReschedule(String(doc._id), 0, 'boom', 30);
    const after = await model.findById(doc._id);
    expect(after!.status).toBe('pending');
    expect(after!.attempts).toBe(1);
    expect(after!.scheduledAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('markFailedOrReschedule marca failed ao esgotar attempts', async () => {
    const [doc] = await model.create([{ exchange: 'ex', routingKey: 'rk', payload: {}, status: 'publishing', attempts: 7, maxAttempts: 8 }]);
    await repo.markFailedOrReschedule(String(doc._id), 7, 'boom', 30);
    const after = await model.findById(doc._id);
    expect(after!.status).toBe('failed');
  });

  it('recoverStalePublishing devolve publishing antigos para pending', async () => {
    await model.create({ exchange: 'ex', routingKey: 'rk', payload: {}, status: 'publishing', processingStartedAt: new Date(Date.now() - 10 * 60 * 1000) });
    const n = await repo.recoverStalePublishing(5 * 60 * 1000);
    expect(n).toBe(1);
    expect((await model.findOne({}))!.status).toBe('pending');
  });
});

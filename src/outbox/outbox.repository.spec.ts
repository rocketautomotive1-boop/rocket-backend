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
});

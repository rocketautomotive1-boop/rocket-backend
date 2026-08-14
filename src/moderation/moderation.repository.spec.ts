import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect, Connection, Model, Types } from 'mongoose';
import {
  ModerationStateModel,
  ModerationStateSchema,
} from './schemas/moderation-state.schema';
import { ModerationRepository } from './moderation.repository';
import { CanonicalModeration } from './providers/moderation-provider.types';

describe('ModerationRepository', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let model: Model<any>;
  let repo: ModerationRepository;

  const marketplaceId = new Types.ObjectId().toString();

  const canonical = (over: Partial<CanonicalModeration> = {}): CanonicalModeration => ({
    marketplace: 'mercadolivre',
    externalId: 'MLB123',
    type: 'WRONG_CATEGORY',
    subgroup: 'DOMAIN',
    infractionId: 'INF-1',
    reason: 'Categoria incorreta',
    remedy: 'Mude a categoria',
    suggestedCategories: [{ externalId: 'MLB99', name: 'Pastilhas' }],
    detectedAt: new Date('2026-06-21T10:00:00.000Z'),
    ...over,
  });

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const m = await connect(server.getUri());
    connection = m.connection;
    model = connection.model(ModerationStateModel.name, ModerationStateSchema);
    repo = new ModerationRepository(model as any);
    await model.init(); // ensure indexes
  });

  afterAll(async () => {
    await connection.close();
    await server.stop();
  });

  afterEach(async () => {
    await model.deleteMany({});
  });

  it('upsertOpen creates an open row keyed by (marketplace, account, externalId)', async () => {
    const doc = await repo.upsertOpen(canonical(), { marketplaceId });
    expect(doc.status).toBe('open');
    expect(doc.externalId).toBe('MLB123');
    expect(doc.type).toBe('WRONG_CATEGORY');
    expect(doc.reason).toBe('Categoria incorreta');
    expect(doc.suggestedCategories).toHaveLength(1);
    expect(doc.suggestedCategories![0]).toMatchObject({ externalId: 'MLB99', name: 'Pastilhas' });
  });

  it('upsertOpen is idempotent — same key updates, does not duplicate', async () => {
    await repo.upsertOpen(canonical(), { marketplaceId });
    await repo.upsertOpen(canonical({ reason: 'Atualizada' }), { marketplaceId });

    const all = await model.find({});
    expect(all).toHaveLength(1);
    expect(all[0].reason).toBe('Atualizada');
  });

  it('different externalId → separate rows', async () => {
    await repo.upsertOpen(canonical({ externalId: 'MLB1' }), { marketplaceId });
    await repo.upsertOpen(canonical({ externalId: 'MLB2' }), { marketplaceId });
    expect(await model.countDocuments({})).toBe(2);
  });

  it('markResolved closes the row and stamps resolvedAt', async () => {
    const doc = await repo.upsertOpen(canonical(), { marketplaceId });
    const resolved = await repo.markResolved(doc._id);
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).toBeInstanceOf(Date);
  });

  it('findAllOpen returns only open rows for the (marketplace, account)', async () => {
    const a = await repo.upsertOpen(canonical({ externalId: 'MLB1' }), { marketplaceId });
    await repo.upsertOpen(canonical({ externalId: 'MLB2' }), { marketplaceId });
    await repo.markResolved(a._id);

    const open = await repo.findAllOpen(marketplaceId, null);
    expect(open.map((d) => d.externalId)).toEqual(['MLB2']);
  });

  it('upsertOpen re-opens a previously resolved row (same listing moderated again)', async () => {
    const doc = await repo.upsertOpen(canonical(), { marketplaceId });
    await repo.markResolved(doc._id);

    const reopened = await repo.upsertOpen(canonical(), { marketplaceId });
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeNull();
    expect(await model.countDocuments({})).toBe(1);
  });

  it('findOpenByExternalIds filters by status and id set', async () => {
    await repo.upsertOpen(canonical({ externalId: 'MLB1' }), { marketplaceId });
    await repo.upsertOpen(canonical({ externalId: 'MLB2' }), { marketplaceId });

    const found = await repo.findOpenByExternalIds(marketplaceId, null, ['MLB1', 'MLBX']);
    expect(found.map((d) => d.externalId)).toEqual(['MLB1']);
  });

  it('persists listingId/productId links when provided', async () => {
    const listingId = new Types.ObjectId().toString();
    const productId = new Types.ObjectId().toString();
    const doc = await repo.upsertOpen(canonical(), { marketplaceId, listingId, productId });
    expect(String(doc.listingId)).toBe(listingId);
    expect(String(doc.productId)).toBe(productId);
  });
});

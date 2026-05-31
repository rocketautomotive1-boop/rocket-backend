// backend/src/marketplace/auth/services/marketplace-account.repository.spec.ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect, Connection, Model, Types } from 'mongoose';
import {
  MarketplaceAccountModel,
  MarketplaceAccountSchema,
} from '../schemas/marketplace-account.schema';
import { MarketplaceAccountRepository } from './marketplace-account.repository';

describe('MarketplaceAccountRepository', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let model: Model<any>;
  let repo: MarketplaceAccountRepository;
  const mpId = new Types.ObjectId();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const m = await connect(server.getUri());
    connection = m.connection;
    model = connection.model(MarketplaceAccountModel.name, MarketplaceAccountSchema);
    await model.init();
    repo = new MarketplaceAccountRepository(model);
  });

  afterAll(async () => {
    await connection.close();
    await server.stop();
  });

  afterEach(async () => {
    await model.deleteMany({});
  });

  it('findDefault returns the default account for a marketplace', async () => {
    await model.create({ marketplaceId: mpId, label: 'ML Autopeças', isDefault: true, domains: ['autoparts'] });
    await model.create({ marketplaceId: mpId, label: 'ML Geral', isDefault: false, domains: ['general'] });

    const found = await repo.findDefault(mpId.toString());
    expect(found?.label).toBe('ML Autopeças');
    expect(found?.isDefault).toBe(true);
  });

  it('returns null when there is no default account', async () => {
    const found = await repo.findDefault(mpId.toString());
    expect(found).toBeNull();
  });

  it('enforces at most one default account per marketplace', async () => {
    await model.create({ marketplaceId: mpId, label: 'A', isDefault: true });
    await expect(
      model.create({ marketplaceId: mpId, label: 'B', isDefault: true }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('findByDomain returns an active account whose domains include the domain', async () => {
    await model.create({ marketplaceId: mpId, label: 'ML Autopeças', isDefault: true, domains: ['autoparts'] });
    await model.create({ marketplaceId: mpId, label: 'ML Geral', isDefault: false, domains: ['general'] });

    const found = await repo.findByDomain(mpId.toString(), 'general');
    expect(found?.label).toBe('ML Geral');
  });

  it('findByDomain returns null when no account serves the domain', async () => {
    await model.create({ marketplaceId: mpId, label: 'ML Autopeças', isDefault: true, domains: ['autoparts'] });
    const found = await repo.findByDomain(mpId.toString(), 'general');
    expect(found).toBeNull();
  });

  it('createAccount persists a non-default account with its domains', async () => {
    const created = await repo.createAccount({
      marketplaceId: mpId,
      label: 'ML Geral',
      domains: ['general'],
      credentials: { clientId: 'enc:v1:abc' },
    });
    expect(created.label).toBe('ML Geral');
    expect(created.isDefault).toBe(false);
    const found = await repo.findByDomain(mpId.toString(), 'general');
    expect(found?.label).toBe('ML Geral');
  });
});

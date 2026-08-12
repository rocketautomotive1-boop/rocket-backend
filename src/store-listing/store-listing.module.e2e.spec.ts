import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { StoreListingModule } from './store-listing.module';
import { StoreListingModel } from './schemas/store-listing.schema';
import { MarketplaceListingModel } from './schemas/marketplace-listing.schema';
import { STORE_LISTING_PORT, StoreListingPort } from './ports/store-listing.port';

describe('StoreListingModule (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let storeListingModel: Model<any>;
  let marketplaceListingModel: Model<any>;
  let port: StoreListingPort;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), StoreListingModule],
    }).compile();

    storeListingModel = moduleRef.get(getModelToken(StoreListingModel.name));
    marketplaceListingModel = moduleRef.get(getModelToken(MarketplaceListingModel.name));
    port = moduleRef.get(STORE_LISTING_PORT);

    await storeListingModel.createCollection();
    await storeListingModel.init();
    await marketplaceListingModel.createCollection();
    await marketplaceListingModel.init();
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await storeListingModel.deleteMany({});
    await marketplaceListingModel.deleteMany({});
  });

  it('STORE_LISTING_PORT resolves to a working StoreListingService', async () => {
    expect(port).toBeDefined();
    const result = await port.findByProductAndStore('000000000000000000000001', '000000000000000000000002');
    expect(result).toBeNull();
  });

  it('enforces unique {productId, storeId} at the database level', async () => {
    await storeListingModel.create({ productId: '000000000000000000000001', storeId: '000000000000000000000002' });
    await expect(
      storeListingModel.create({ productId: '000000000000000000000001', storeId: '000000000000000000000002' }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('enforces unique {storeListingId, marketplaceTag} at the database level', async () => {
    const storeListingId = '000000000000000000000003';
    await marketplaceListingModel.create({
      storeListingId,
      marketplaceTag: 'mercadolivre',
      accountId: 'ACC_A',
      externalId: null,
      status: 'pending_creation',
    });
    await expect(
      marketplaceListingModel.create({
        storeListingId,
        marketplaceTag: 'mercadolivre',
        accountId: 'ACC_B',
        externalId: null,
        status: 'pending_creation',
      }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows two marketplace_listings for the same storeListingId on DIFFERENT marketplaces', async () => {
    const storeListingId = '000000000000000000000004';
    await marketplaceListingModel.create({
      storeListingId,
      marketplaceTag: 'mercadolivre',
      accountId: 'ACC_A',
      externalId: null,
      status: 'pending_creation',
    });
    await marketplaceListingModel.create({
      storeListingId,
      marketplaceTag: 'shopee',
      accountId: 'ACC_C',
      externalId: null,
      status: 'pending_creation',
    });

    const count = await marketplaceListingModel.countDocuments({ storeListingId });
    expect(count).toBe(2);
  });
});

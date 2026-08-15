// backend/src/store-listing/backfill.e2e.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { StoreListingModule } from './store-listing.module';
import { StoreModule } from '../store/store.module';
import { MarketplaceConfigCacheModule } from '../marketplace/services/marketplace-config-cache.module';
import { StoreListingService } from './store-listing.service';
import { StoreService } from '../store/services/store.service';
import { StoreListingStockLotModel } from './schemas/store-listing-stock-lot.schema';
import { backfillStoreListings, ListingRow } from '../../scripts/backfill-store-listings';
import { backfillStock, StockLotRow } from '../../scripts/backfill-store-listing-stock';

describe('StoreListing Phase 2 backfill (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let storeListingService: StoreListingService;
  let storeService: StoreService;
  let stockLotModel: Model<any>;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MarketplaceConfigCacheModule,
        StoreModule,
        StoreListingModule,
      ],
    }).compile();

    storeListingService = moduleRef.get(StoreListingService);
    storeService = moduleRef.get(StoreService);
    stockLotModel = moduleRef.get(getModelToken(StoreListingStockLotModel.name));
    await stockLotModel.createCollection();
    await stockLotModel.init();
  });

  afterAll(async () => {
    const conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.close();
    await moduleRef.close();
    await mongo.stop();
  });

  it('backfillStoreListings against a real StoreListingService is idempotent across two runs', async () => {
    const rocket = await storeService.create('Rocket Automotive');
    await storeService.setMarketplaceAccount(rocket.id, 'mercadolivre', 'ACC_REAL');

    const productId = new Types.ObjectId();
    const listing: ListingRow = {
      _id: new Types.ObjectId(),
      productId,
      marketplaceId: new Types.ObjectId(),
      externalId: 'MLB999',
      status: 'active',
      createdByUserId: null,
    };

    const listingModelStub = { updateOne: jest.fn().mockResolvedValue({}) };

    const run = () =>
      backfillStoreListings({
        listings: [listing],
        resolveStore: async () => rocket.id,
        storeListingService,
        resolveMarketplaceTag: async () => 'mercadolivre',
        resolveAccountId: async () => storeService.resolveAccountId(rocket.id, 'mercadolivre'),
        listingModel: listingModelStub as any,
        dryRun: false,
      });

    const first = await run();
    expect(first.storeListingsCreated).toBe(1);
    expect(first.marketplaceListingsCreated).toBe(1);

    // Second run against the SAME (already-persisted) StoreListing and
    // MarketplaceListing: StoreListingService.create/createMarketplaceListing
    // both throw BadRequestException on duplicate (E11000 caught internally).
    // backfillStoreListings catches that specifically for
    // createMarketplaceListing and counts it as `marketplaceListingsReused`
    // instead of re-throwing — so the second call must not throw, must reuse
    // the existing StoreListing, and must NOT increment
    // marketplaceListingsCreated again.
    const second = await run();
    expect(second.storeListingsCreated).toBe(0);
    expect(second.storeListingsReused).toBe(1);
    expect(second.marketplaceListingsCreated).toBe(0);
    expect(second.marketplaceListingsReused).toBe(1);
  });

  it('backfillStock against real models does not duplicate lots on a second run', async () => {
    const rocket = await storeService.findByName('Rocket Automotive');
    const productId = new Types.ObjectId();
    const lot: StockLotRow = {
      _id: new Types.ObjectId(),
      productId,
      condition: 'new',
      unitCost: '42.00',
      createdByUserId: null,
    };

    const run = () =>
      backfillStock({
        lots: [lot],
        resolveStore: async () => rocket!.id,
        storeListingService,
        stockLotModel: stockLotModel as any,
        dryRun: false,
      });

    const first = await run();
    expect(first.lotsCreated).toBe(1);

    const second = await run();
    expect(second.lotsCreated).toBe(0);
    expect(second.lotsSkippedAlreadyMigrated).toBe(1);

    const count = await stockLotModel.countDocuments({ originalLotId: lot._id });
    expect(count).toBe(1);
  });

  it('rejects a second lot for the same (storeListingId, condition) even when the first has no originalLotId (organic dual-write lot)', async () => {
    // Reproduces the production bug: a lot created organically via
    // StoreListingService.recordStockMovement (no originalLotId — see
    // recordStockMovement's $setOnInsert) already exists for (storeListingId,
    // condition) when the backfill script later runs and tries to insert its
    // own migrated lot for the SAME pair. The originalLotId unique-sparse
    // index does nothing here (the organic lot has no originalLotId to
    // collide on) — only a unique index on {storeListingId, condition} stops
    // the duplicate.
    const rocket = await storeService.findByName('Rocket Automotive');
    const productId = new Types.ObjectId();
    const created = await storeListingService.create(String(productId), rocket!.id);
    const storeListingId = new Types.ObjectId(created.id);

    await stockLotModel.create({ storeListingId, condition: 'new', unitCost: '10.00' });

    await expect(
      stockLotModel.create({ storeListingId, condition: 'new', unitCost: '20.00', originalLotId: new Types.ObjectId() }),
    ).rejects.toThrow(/duplicate key|E11000/);

    const count = await stockLotModel.countDocuments({ storeListingId, condition: 'new' });
    expect(count).toBe(1);
  });
});

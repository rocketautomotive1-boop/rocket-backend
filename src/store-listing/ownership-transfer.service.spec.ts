import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { StoreListingOwnershipService } from './ownership-transfer.service';
import { StoreListingModel, StoreListingSchema } from './schemas/store-listing.schema';
import {
  StoreListingStockBalanceModel,
  StoreListingStockBalanceSchema,
} from './schemas/store-listing-stock-balance.schema';
import { StoreListingStockLotModel, StoreListingStockLotSchema } from './schemas/store-listing-stock-lot.schema';
import {
  StoreListingStockMovementModel,
  StoreListingStockMovementSchema,
} from './schemas/store-listing-stock-movement.schema';
import {
  StoreListingDamagedUnitModel,
  StoreListingDamagedUnitSchema,
} from './schemas/store-listing-damaged-unit.schema';
import { MarketplaceListingModel, MarketplaceListingSchema } from './schemas/marketplace-listing.schema';
import { OwnershipTransferLogModel, OwnershipTransferLogSchema } from './schemas/ownership-transfer-log.schema';
import { ListingModel, ListingSchema } from '../listing/schemas/listing.schema';

describe('StoreListingOwnershipService (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let mod: TestingModule;
  let svc: StoreListingOwnershipService;
  let storeListingModel: Model<any>;
  let balanceModel: Model<any>;
  let lotModel: Model<any>;
  let movementModel: Model<any>;
  let damagedUnitModel: Model<any>;
  let marketplaceListingModel: Model<any>;
  let transferLogModel: Model<any>;
  let listingModel: Model<any>;

  const PRODUCT = new Types.ObjectId();
  const STORE_A = new Types.ObjectId();
  const STORE_B = new Types.ObjectId();
  const MARKETPLACE = new Types.ObjectId();

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mod = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: StoreListingModel.name, schema: StoreListingSchema },
          { name: StoreListingStockBalanceModel.name, schema: StoreListingStockBalanceSchema },
          { name: StoreListingStockLotModel.name, schema: StoreListingStockLotSchema },
          { name: StoreListingStockMovementModel.name, schema: StoreListingStockMovementSchema },
          { name: StoreListingDamagedUnitModel.name, schema: StoreListingDamagedUnitSchema },
          { name: MarketplaceListingModel.name, schema: MarketplaceListingSchema },
          { name: OwnershipTransferLogModel.name, schema: OwnershipTransferLogSchema },
          { name: ListingModel.name, schema: ListingSchema },
        ]),
      ],
      providers: [StoreListingOwnershipService],
    }).compile();

    svc = mod.get(StoreListingOwnershipService);
    storeListingModel = mod.get(getModelToken(StoreListingModel.name));
    balanceModel = mod.get(getModelToken(StoreListingStockBalanceModel.name));
    lotModel = mod.get(getModelToken(StoreListingStockLotModel.name));
    movementModel = mod.get(getModelToken(StoreListingStockMovementModel.name));
    damagedUnitModel = mod.get(getModelToken(StoreListingDamagedUnitModel.name));
    marketplaceListingModel = mod.get(getModelToken(MarketplaceListingModel.name));
    transferLogModel = mod.get(getModelToken(OwnershipTransferLogModel.name));
    listingModel = mod.get(getModelToken(ListingModel.name));

    // Transações multi-documento não podem criar collection na primeira escrita — precisa existir antes.
    await storeListingModel.createCollection();
    await balanceModel.createCollection();
    await lotModel.createCollection();
    await movementModel.createCollection();
    await damagedUnitModel.createCollection();
    await marketplaceListingModel.createCollection();
    await transferLogModel.createCollection();
    await listingModel.createCollection();
    await balanceModel.syncIndexes();
    await lotModel.syncIndexes();
    await marketplaceListingModel.syncIndexes();
  });

  afterEach(async () => {
    await Promise.all([
      storeListingModel.deleteMany({}),
      balanceModel.deleteMany({}),
      lotModel.deleteMany({}),
      movementModel.deleteMany({}),
      damagedUnitModel.deleteMany({}),
      marketplaceListingModel.deleteMany({}),
      transferLogModel.deleteMany({}),
      listingModel.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    const c = mod.get<Connection>(getConnectionToken());
    await c.close();
    await mongo.stop();
  });

  it('noop quando não existe StoreListing de origem', async () => {
    const result = await svc.transferOwnership({
      productId: String(PRODUCT),
      fromStoreId: String(STORE_A),
      toStoreId: String(STORE_B),
      reason: 'test',
    });
    expect(result.kind).toBe('noop');
  });

  it('repoint: destino livre — só reaponta storeId, filhos continuam intactos', async () => {
    const sl = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_A });
    await balanceModel.create({ storeListingId: sl._id, lotId: new Types.ObjectId(), condition: 'new', onHand: 5, reserved: 1 });
    await lotModel.create({ storeListingId: sl._id, condition: 'new' });
    await movementModel.create({ storeListingId: sl._id, type: 'inbound', quantity: 5 });
    await marketplaceListingModel.create({
      storeListingId: sl._id,
      marketplaceTag: 'mercadolivre',
      accountId: 'acc-1',
      externalId: 'MLB123',
      status: 'active',
    });
    await listingModel.create({
      productId: PRODUCT,
      marketplaceId: MARKETPLACE,
      storeId: STORE_A,
      title: 'x',
      externalId: 'MLB123',
    });

    const result = await svc.transferOwnership({
      productId: String(PRODUCT),
      fromStoreId: String(STORE_A),
      toStoreId: String(STORE_B),
      reason: 'test repoint',
    });

    expect(result.kind).toBe('repoint');
    expect(result.sourceStoreListingId).toBe(String(sl._id));

    const updatedSl = await storeListingModel.findById(sl._id).lean();
    expect(String(updatedSl.storeId)).toBe(String(STORE_B));

    // filhos não tocados — continuam apontando pro mesmo storeListingId, que não mudou
    const balance = await balanceModel.findOne({ storeListingId: sl._id }).lean();
    expect(balance.onHand).toBe(5);
    const ml = await marketplaceListingModel.findOne({ storeListingId: sl._id }).lean();
    expect(ml.externalId).toBe('MLB123');

    const updatedListing = await listingModel.findOne({ productId: PRODUCT }).lean();
    expect(String(updatedListing.storeId)).toBe(String(STORE_B));

    const log = await transferLogModel.findOne({ productId: PRODUCT }).lean();
    expect(log.kind).toBe('repoint');
    expect(log.reason).toBe('test repoint');
  });

  it('merge: destino ocupado — soma balances, move filhos, apaga origem', async () => {
    const source = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_A });
    const destination = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_B });

    await balanceModel.create({ storeListingId: source._id, lotId: new Types.ObjectId(), condition: 'new', onHand: 3, reserved: 0 });
    await balanceModel.create({ storeListingId: destination._id, lotId: new Types.ObjectId(), condition: 'new', onHand: 2, reserved: 1 });
    await lotModel.create({ storeListingId: source._id, condition: 'damaged' }); // condition SEM conflito no destino
    await movementModel.create({ storeListingId: source._id, type: 'inbound', quantity: 3 });
    await marketplaceListingModel.create({
      storeListingId: source._id,
      marketplaceTag: 'mercadolivre',
      accountId: 'acc-1',
      externalId: 'MLB999',
      status: 'active',
    });

    const result = await svc.transferOwnership({
      productId: String(PRODUCT),
      fromStoreId: String(STORE_A),
      toStoreId: String(STORE_B),
      reason: 'test merge',
    });

    expect(result.kind).toBe('merge');
    expect(result.destinationStoreListingId).toBe(String(destination._id));

    const sourceGone = await storeListingModel.findById(source._id).lean();
    expect(sourceGone).toBeNull();

    const mergedBalance = await balanceModel.findOne({ storeListingId: destination._id, condition: 'new' }).lean();
    expect(mergedBalance.onHand).toBe(5); // 3 + 2
    expect(mergedBalance.reserved).toBe(1);

    const movedLot = await lotModel.findOne({ storeListingId: destination._id, condition: 'damaged' }).lean();
    expect(movedLot).not.toBeNull();
    const movedMovement = await movementModel.findOne({ storeListingId: destination._id }).lean();
    expect(movedMovement).not.toBeNull();
    const movedMl = await marketplaceListingModel.findOne({ storeListingId: destination._id, externalId: 'MLB999' }).lean();
    expect(movedMl).not.toBeNull();
  });

  it('merge: lot de origem e destino com a MESMA condition não colide no índice único — regressão do incidente 2026-08-30 (35/883 casos falharam com E11000 em store_listing_stock_lots)', async () => {
    const source = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_A });
    const destination = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_B });

    const sourceLot = await lotModel.create({ storeListingId: source._id, condition: 'new', unitCost: '10' });
    const destinationLot = await lotModel.create({ storeListingId: destination._id, condition: 'new', unitCost: '12' });

    await balanceModel.create({ storeListingId: source._id, lotId: sourceLot._id, condition: 'new', onHand: 2, reserved: 0 });
    await balanceModel.create({ storeListingId: destination._id, lotId: destinationLot._id, condition: 'new', onHand: 1, reserved: 0 });

    await movementModel.create({ storeListingId: source._id, lotId: sourceLot._id, type: 'inbound', quantity: 2 });

    const result = await svc.transferOwnership({
      productId: String(PRODUCT),
      fromStoreId: String(STORE_A),
      toStoreId: String(STORE_B),
      reason: 'test merge lot collision',
    });

    expect(result.kind).toBe('merge');

    // o lot de origem foi descartado (não duplica {storeListingId, condition} no destino)
    const remainingLots = await lotModel.find({ storeListingId: destination._id, condition: 'new' }).lean();
    expect(remainingLots).toHaveLength(1);
    expect(String(remainingLots[0]._id)).toBe(String(destinationLot._id));

    // o movement que apontava pro lot de origem foi reapontado pro lot vencedor (destino) — nunca perde a referência
    const movedMovement = await movementModel.findOne({ storeListingId: destination._id }).lean();
    expect(movedMovement).not.toBeNull();
    expect(String(movedMovement.lotId)).toBe(String(destinationLot._id));

    const mergedBalance = await balanceModel.findOne({ storeListingId: destination._id, condition: 'new' }).lean();
    expect(mergedBalance.onHand).toBe(3); // 2 + 1
  });

  it('merge: conflito de externalId entre origem e destino aborta a transação inteira', async () => {
    const source = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_A });
    const destination = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_B });

    await balanceModel.create({ storeListingId: source._id, lotId: new Types.ObjectId(), condition: 'new', onHand: 1, reserved: 0 });
    await marketplaceListingModel.create({
      storeListingId: source._id,
      marketplaceTag: 'mercadolivre',
      accountId: 'acc-1',
      externalId: 'MLB-DUP',
      status: 'active',
    });
    await marketplaceListingModel.create({
      storeListingId: destination._id,
      marketplaceTag: 'mercadolivre',
      accountId: 'acc-2',
      externalId: 'MLB-DUP',
      status: 'active',
    });

    await expect(
      svc.transferOwnership({
        productId: String(PRODUCT),
        fromStoreId: String(STORE_A),
        toStoreId: String(STORE_B),
        reason: 'test conflict',
      }),
    ).rejects.toThrow();

    // nada foi alterado — transação abortada
    const sourceStillThere = await storeListingModel.findById(source._id).lean();
    expect(sourceStillThere).not.toBeNull();
    const logCount = await transferLogModel.countDocuments({ productId: PRODUCT });
    expect(logCount).toBe(0);
  });

  it('bloqueia quando há boxId preenchido — não move depósito físico', async () => {
    const sl = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_A });
    await balanceModel.create({ storeListingId: sl._id, lotId: new Types.ObjectId(), condition: 'new', onHand: 1, boxId: new Types.ObjectId() });

    await expect(
      svc.transferOwnership({
        productId: String(PRODUCT),
        fromStoreId: String(STORE_A),
        toStoreId: String(STORE_B),
        reason: 'test blocked',
      }),
    ).rejects.toThrow(/boxId/);

    const untouched = await storeListingModel.findById(sl._id).lean();
    expect(String(untouched.storeId)).toBe(String(STORE_A));
  });

  it('dryRun: calcula o plano mas não escreve nada', async () => {
    const sl = await storeListingModel.create({ productId: PRODUCT, storeId: STORE_A });
    await balanceModel.create({ storeListingId: sl._id, lotId: new Types.ObjectId(), condition: 'new', onHand: 4 });

    const result = await svc.transferOwnership({
      productId: String(PRODUCT),
      fromStoreId: String(STORE_A),
      toStoreId: String(STORE_B),
      reason: 'dry run test',
      dryRun: true,
    });

    expect(result.kind).toBe('repoint');

    const untouched = await storeListingModel.findById(sl._id).lean();
    expect(String(untouched.storeId)).toBe(String(STORE_A));
    const logCount = await transferLogModel.countDocuments({});
    expect(logCount).toBe(0);
  });

  it('rejeita fromStoreId igual a toStoreId', async () => {
    await expect(
      svc.transferOwnership({
        productId: String(PRODUCT),
        fromStoreId: String(STORE_A),
        toStoreId: String(STORE_A),
        reason: 'same store',
      }),
    ).rejects.toThrow();
  });
});

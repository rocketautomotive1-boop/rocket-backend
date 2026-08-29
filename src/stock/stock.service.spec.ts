import { Global, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Connection, Types, Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { StockService } from './stock.service';
import { StoreListingStockQueryService } from './store-listing-stock-query.service';
import { StockMovementType } from '../stock-shared/movement-type';
import { StoreListingModule } from '../store-listing/store-listing.module';
import { STOCK_QUERY_PORT } from './ports/stock-query.port';
import { PRICING_PORT } from '../pricing/ports/pricing.port';
import { StoreListingStockMovementModel, StoreListingStockMovementSchema } from '../store-listing/schemas/store-listing-stock-movement.schema';
import { StoreListingStockBalanceModel, StoreListingStockBalanceSchema } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockLotModel, StoreListingStockLotSchema } from '../store-listing/schemas/store-listing-stock-lot.schema';
import { StoreListingModel, StoreListingSchema } from '../store-listing/schemas/store-listing.schema';
import { MarketplaceListingModel } from '../store-listing/schemas/marketplace-listing.schema';

/**
 * StoreListingModule (importado abaixo) injeta STOCK_QUERY_PORT/PRICING_PORT no construtor
 * (getAllocationProducts) — em produção StockModule é @Global (ver stock.module.ts), mas este
 * teste monta só um subconjunto de módulos, sem AppModule, então os tokens não existem sem
 * este mock. @Global aqui pela mesma razão do mock em store-listing.module.e2e.spec.ts: um
 * módulo importado só enxerga providers do módulo-pai via export.
 */
@Global()
@Module({
  providers: [
    { provide: STOCK_QUERY_PORT, useValue: {} },
    { provide: PRICING_PORT, useValue: {} },
  ],
  exports: [STOCK_QUERY_PORT, PRICING_PORT],
})
class MockStockPricingModule {}

/**
 * Contract completo (2026-08-29): store_listing_stock_* é a única fonte de verdade — o legado
 * (stock_balances/stock_lots/stock_movements) foi removido após validação em produção.
 */
describe('StockService (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let mod: TestingModule;
  let svc: StockService;
  let query: StoreListingStockQueryService;
  let storeListingModel: Model<any>;
  let marketplaceListingModel: Model<any>;
  let slMovementModel: Model<any>;
  let slBalanceModel: Model<any>;
  let slLotModel: Model<any>;
  const PID = '650000000000000000000001';
  const STORE_A = '650000000000000000040001';

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mod = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: StoreListingStockMovementModel.name, schema: StoreListingStockMovementSchema },
          { name: StoreListingStockBalanceModel.name, schema: StoreListingStockBalanceSchema },
          { name: StoreListingStockLotModel.name, schema: StoreListingStockLotSchema },
          { name: StoreListingModel.name, schema: StoreListingSchema },
        ]),
        MockStockPricingModule,
        StoreListingModule,
      ],
      providers: [StockService, StoreListingStockQueryService],
    }).compile();
    svc = mod.get(StockService);
    query = mod.get(StoreListingStockQueryService);
    storeListingModel = mod.get(getModelToken(StoreListingModel.name));
    marketplaceListingModel = mod.get(getModelToken(MarketplaceListingModel.name));
    slMovementModel = mod.get(getModelToken(StoreListingStockMovementModel.name));
    slBalanceModel = mod.get(getModelToken(StoreListingStockBalanceModel.name));
    slLotModel = mod.get(getModelToken(StoreListingStockLotModel.name));

    // Pre-create collections + indexes. MongoDB cannot create a collection inside a
    // multi-document transaction, so creating them lazily during the first move() would fail.
    await storeListingModel.createCollection();
    await marketplaceListingModel.createCollection();
    await slMovementModel.createCollection();
    await slBalanceModel.createCollection();
    await slLotModel.createCollection();
    await slMovementModel.syncIndexes();
    await slBalanceModel.syncIndexes();
    await slLotModel.syncIndexes();
  });

  afterAll(async () => {
    const c = mod.get<Connection>(getConnectionToken());
    await c.close();
    await mod.close();
    await mongo.stop();
  });

  it('inbound then outbound nets correct onHand', async () => {
    await svc.move({ productId: PID, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 2, reference: 'in-1' });
    await svc.move({ productId: PID, storeId: STORE_A, type: StockMovementType.OUTBOUND, quantity: 3, condition: 'new', reference: 'out-1' });
    const stock = await query.getProductStock(PID);
    expect(stock.onHand).toBe(7);
  });

  it('duplicate reference is idempotent', async () => {
    await svc.move({ productId: PID, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dup' });
    await svc.move({ productId: PID, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dup' });
    const count = await slMovementModel.countDocuments({ 'metadata.externalReference': 'dup' });
    expect(count).toBe(1);
  });

  it('reservation increments reserved without touching onHand', async () => {
    const onHandBefore = (await query.getProductStock(PID)).onHand;
    await svc.move({ productId: PID, storeId: STORE_A, type: StockMovementType.RESERVATION, quantity: 2, condition: 'new', reference: 'res-1' });
    const stock = await query.getProductStock(PID);
    expect(stock.reserved).toBe(2);
    expect(stock.onHand).toBe(onHandBefore); // reservation doesn't change physical stock
  });

  it('adjust applies a signed correction to onHand (append-only)', async () => {
    const PID2 = '650000000000000000000777';
    await svc.move({ productId: PID2, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', reference: 'adj-seed' });
    await svc.adjust({ productId: PID2, storeId: STORE_A, quantity: -2, condition: 'new', reason: 'inventory count', reference: 'adj-1' });
    const stock = await query.getProductStock(PID2);
    expect(stock.onHand).toBe(8);
    // ledger is append-only: 2 movements, none deleted
    const storeListing = await storeListingModel.findOne({ productId: PID2, storeId: STORE_A }).exec();
    const count = await slMovementModel.countDocuments({ storeListingId: storeListing!._id });
    expect(count).toBe(2);
  });

  it('listMovements returns movements newest-first', async () => {
    const PID3 = '650000000000000000000888';
    await svc.move({ productId: PID3, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 4, condition: 'new', unitCost: 1, reference: 'lm1' });
    const list = await query.listMovements(PID3, 10);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].type).toBe('inbound');
  });

  it('getMovementStatistics aggregates by type', async () => {
    const PID4 = '650000000000000000000999';
    await svc.move({ productId: PID4, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 's1' });
    await svc.move({ productId: PID4, storeId: STORE_A, type: StockMovementType.OUTBOUND, quantity: 2, condition: 'new', reference: 's2' });
    const stats = await query.getMovementStatistics(PID4);
    expect(stats['inbound'].quantity).toBe(5);
    expect(stats['outbound'].quantity).toBe(2);
  });

  it('listMovements exposes id, condition and date for the UI', async () => {
    const r = await svc.move({ productId: PID, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 4, condition: 'used', unitCost: 9, reference: 'lm-1' });
    const list = await query.listMovements(PID, 50);
    const found = list.find((m: any) => m.id === r.movementId);
    expect(found).toBeTruthy();
    expect(found.condition).toBe('used');
    expect(found.date).toBeInstanceOf(Date);
    expect(found.unitCost).toBe(9);
  });

  it('getProductCost returns the weighted-average lot cost', async () => {
    const P2 = '650000000000000000000abc';
    // Two distinct lots (different conditions) with unequal quantities:
    //   30 @ 2 (new) + 10 @ 6 (used) → weighted avg = (30*2 + 10*6) / 40 = 120/40 = 3.0
    // A simple unweighted mean would be (2+6)/2 = 4.0, so this pins the WEIGHTING.
    await svc.move({ productId: P2, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 30, condition: 'new', unitCost: 2, reference: 'ac-1' });
    await svc.move({ productId: P2, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 10, condition: 'used', unitCost: 6, reference: 'ac-2' });
    const cost = await query.getProductCost(P2);
    expect(cost).toBeCloseTo(3, 2);
  });

  it('weighted-average cost is also correct across TWO inbound movements in the SAME lot/condition', async () => {
    const P2B = '650000000000000000000abd';
    // 10 units @ 2, then 10 units @ 6 in the SAME condition (single lot):
    // weighted avg = (10*2 + 10*6) / 20 = 4.0
    await svc.move({ productId: P2B, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 2, reference: 'ac2-1' });
    await svc.move({ productId: P2B, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 6, reference: 'ac2-2' });
    const cost = await query.getProductCost(P2B);
    expect(cost).toBeCloseTo(4, 2);
  });

  it('editMovementViaAdjustment on a boxed movement corrects that box balance, not a phantom unlocated one', async () => {
    const P3 = '650000000000000000000bcd';
    const BOX = '650000000000000000009999';
    const created = await svc.move({
      productId: P3, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 5, toBoxId: BOX, reference: 'box-edit-seed',
    });

    await svc.editMovementViaAdjustment(created.movementId, 6);

    const byLocation = await query.getByLocation(P3);
    const boxRow = byLocation.find((r: any) => String(r.boxId) === BOX);
    const unlocatedRow = byLocation.find((r: any) => r.boxId == null);
    expect(boxRow?.onHand).toBe(6);
    expect(unlocatedRow).toBeUndefined();
  });

  it('reverseMovement on a boxed movement reverses that box balance, not a phantom unlocated one', async () => {
    const P4 = '650000000000000000000cde';
    const BOX = '650000000000000000009999';
    const created = await svc.move({
      productId: P4, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 8, condition: 'new', unitCost: 5, toBoxId: BOX, reference: 'box-delete-seed',
    });

    await svc.reverseMovement(created.movementId);

    const byLocation = await query.getByLocation(P4);
    const boxRow = byLocation.find((r: any) => String(r.boxId) === BOX);
    const unlocatedRow = byLocation.find((r: any) => r.boxId == null);
    expect(boxRow?.onHand ?? 0).toBe(0);
    expect(unlocatedRow).toBeUndefined();
  });

  it('reverseMovement reads storeId from the original movement — no fallback needed when it is present', async () => {
    const P4B = '650000000000000000000cdf';
    const created = await svc.move({
      productId: P4B, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 3, condition: 'new', reference: 'box-delete-seed-2',
    });

    // No fallbackStoreId passed — must resolve storeId from the original movement's own StoreListing.
    await expect(svc.reverseMovement(created.movementId)).resolves.toBeDefined();
  });

  it('reverseMovement throws when the movement id does not resolve to any movement and no fallback is given', async () => {
    await expect(svc.reverseMovement(new Types.ObjectId().toHexString())).rejects.toThrow(/não tem loja associada|not found/i);
  });

  it('correctTo brings onHand to the target quantity regardless of current value', async () => {
    const P7 = '650000000000000000001111';
    await svc.move({ productId: P7, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'ct-seed' });

    await svc.correctTo({ productId: P7, storeId: STORE_A, condition: 'new', targetQuantity: 12 });
    let stock = await query.getProductStock(P7);
    expect(stock.onHand).toBe(12);

    await svc.correctTo({ productId: P7, storeId: STORE_A, condition: 'new', targetQuantity: 3 });
    stock = await query.getProductStock(P7);
    expect(stock.onHand).toBe(3);
  });

  it('correctTo is a no-op when target equals current (no movement created)', async () => {
    const P8 = '650000000000000000002222';
    await svc.move({ productId: P8, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 7, condition: 'new', reference: 'ct-noop-seed' });
    const storeListing = await storeListingModel.findOne({ productId: P8, storeId: STORE_A }).exec();
    const before = await slMovementModel.countDocuments({ storeListingId: storeListing!._id });

    const result = await svc.correctTo({ productId: P8, storeId: STORE_A, condition: 'new', targetQuantity: 7 });
    const after = await slMovementModel.countDocuments({ storeListingId: storeListing!._id });

    expect(result).toBeNull();
    expect(after).toBe(before);
  });

  it('correctTo defaults to condition "new" and only affects that condition\'s balance', async () => {
    const P9 = '650000000000000000003333';
    await svc.move({ productId: P9, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'ct-cond-new' });
    await svc.move({ productId: P9, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 9, condition: 'used', reference: 'ct-cond-used' });

    await svc.correctTo({ productId: P9, storeId: STORE_A, targetQuantity: 1 });

    const byCondition = await query.getByCondition(P9);
    const newRow = byCondition.find((r: any) => r.condition === 'new');
    const usedRow = byCondition.find((r: any) => r.condition === 'used');
    expect(newRow?.onHand).toBe(1);
    expect(usedRow?.onHand).toBe(9);
  });

  it('two adjustments without a reference for the same product do not collide on the idempotency index', async () => {
    const P6 = '650000000000000000000eff';
    await svc.adjust({ productId: P6, storeId: STORE_A, quantity: 5, condition: 'new', reason: 'first correction' });
    await expect(
      svc.adjust({ productId: P6, storeId: STORE_A, quantity: 3, condition: 'new', reason: 'second correction' }),
    ).resolves.toBeDefined();
  });

  it('concurrent edits of the same movement (double-tap) do not throw a write-conflict error', async () => {
    const P5 = '650000000000000000000def';
    const created = await svc.move({
      productId: P5, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 5, reference: 'race-seed',
    });

    await expect(
      Promise.all([
        svc.editMovementViaAdjustment(created.movementId, 4),
        svc.editMovementViaAdjustment(created.movementId, 4),
      ]),
    ).resolves.toBeDefined();
  });

  describe('move — writes and transactions', () => {
    it('writes a successful INBOUND move into store_listing_stock_*, under the storeId passed by the caller', async () => {
      const P = '650000000000000000010001';
      const result = await svc.move({ productId: P, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dw-1' });
      expect(result.movementId).toBeTruthy();

      const storeListing = await storeListingModel.findOne({ productId: P, storeId: STORE_A }).exec();
      expect(storeListing).toBeTruthy();

      const movements = await slMovementModel.find({ storeListingId: String(storeListing!._id) }).exec();
      expect(movements.length).toBe(1);
      expect(movements[0].type).toBe(StockMovementType.INBOUND);
      expect(movements[0].quantity).toBe(5);

      const stock = await query.getProductStock(P);
      expect(stock.onHand).toBe(5);
    });

    it('two stores writing the same product get independent StoreListings/balances — no cross-store leakage', async () => {
      const P = '650000000000000000010003';
      const STORE_B = '650000000000000000020002';

      await svc.move({ productId: P, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 4, condition: 'new', reference: 'dw-3-a' });
      await svc.move({ productId: P, storeId: STORE_B, type: StockMovementType.INBOUND, quantity: 9, condition: 'new', reference: 'dw-3-b' });

      const listingA = await storeListingModel.findOne({ productId: P, storeId: STORE_A }).exec();
      const listingB = await storeListingModel.findOne({ productId: P, storeId: STORE_B }).exec();
      expect(listingA).toBeTruthy();
      expect(listingB).toBeTruthy();
      expect(String(listingA!._id)).not.toBe(String(listingB!._id));

      const balancesA = await slBalanceModel.find({ storeListingId: String(listingA!._id) }).exec();
      const balancesB = await slBalanceModel.find({ storeListingId: String(listingB!._id) }).exec();
      expect(balancesA.reduce((s: number, r: any) => s + r.onHand, 0)).toBe(4);
      expect(balancesB.reduce((s: number, r: any) => s + r.onHand, 0)).toBe(9);
    });

    it('writes a TRANSFER as two separate signed movements (debit + credit), not a zero-effect no-op', async () => {
      const P = '650000000000000000010004';
      const BOX_A = '650000000000000000030001';
      const BOX_B = '650000000000000000030002';

      await svc.move({ productId: P, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', toBoxId: BOX_A, reference: 'dw-4-seed' });
      await svc.move({ productId: P, storeId: STORE_A, type: StockMovementType.TRANSFER, quantity: 6, condition: 'new', fromBoxId: BOX_A, toBoxId: BOX_B, reference: 'dw-4-transfer' });

      const byLocation = await query.getByLocation(P);
      const totalOnHand = byLocation.reduce((s: number, r: any) => s + r.onHand, 0);
      // Net onHand across boxes must stay 10 (transfer only moves location, no net change).
      expect(totalOnHand).toBe(10);

      const boxARow = byLocation.find((r: any) => String(r.boxId) === BOX_A);
      const boxBRow = byLocation.find((r: any) => String(r.boxId) === BOX_B);
      expect(boxARow?.onHand).toBe(4);
      expect(boxBRow?.onHand).toBe(6);
    });

    it('does not create a second movement on duplicate reference', async () => {
      const P = '650000000000000000010005';
      await svc.move({ productId: P, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dw-5-dup' });
      await svc.move({ productId: P, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dw-5-dup' });

      const storeListing = await storeListingModel.findOne({ productId: P, storeId: STORE_A }).exec();
      const movements = await slMovementModel.find({ storeListingId: String(storeListing!._id) }).exec();
      expect(movements.length).toBe(1);
    });

    it('writes inside an externally-owned session (caller commits later) — this is the primary write, it cannot be skipped', async () => {
      const P = '650000000000000000010006';
      const session = await mod.get<Connection>(getConnectionToken()).startSession();
      session.startTransaction();
      try {
        const result = await svc.move(
          { productId: P, storeId: STORE_A, type: StockMovementType.INBOUND, quantity: 7, condition: 'new', reference: 'dw-6-ext' },
          session,
        );
        expect(result.movementId).toBeTruthy();
        await session.commitTransaction();
      } catch (err) {
        await session.abortTransaction();
        throw err;
      } finally {
        await session.endSession();
      }

      const stock = await query.getProductStock(P);
      expect(stock.onHand).toBe(7);
    });
  });
});

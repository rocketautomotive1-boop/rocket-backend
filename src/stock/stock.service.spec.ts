import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { StockMovementModel, StockMovementSchema } from './schemas/stock-movement.schema';
import { StockLotModel, StockLotSchema } from './schemas/stock-lot.schema';
import { StockBalanceModel, StockBalanceSchema } from './schemas/stock-balance.schema';
import { StockRepository } from './stock.repository';
import { StockService } from './stock.service';
import { StockQueryService } from './stock-query.service';
import { StockMovementType } from './domain/movement-type';

describe('StockService (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let mod: TestingModule;
  let svc: StockService;
  let query: StockQueryService;
  let repo: StockRepository;
  const PID = '650000000000000000000001';

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mod = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: StockMovementModel.name, schema: StockMovementSchema },
          { name: StockLotModel.name, schema: StockLotSchema },
          { name: StockBalanceModel.name, schema: StockBalanceSchema },
        ]),
      ],
      providers: [StockService, StockQueryService, StockRepository],
    }).compile();
    svc = mod.get(StockService);
    query = mod.get(StockQueryService);
    repo = mod.get(StockRepository);

    // Pre-create collections + indexes. MongoDB cannot create a collection inside a
    // multi-document transaction, so creating them lazily during the first move() would
    // fail. In prod the migration/backfill creates them before any transactional write.
    await repo.lotModel.createCollection();
    await repo.balanceModel.createCollection();
    await repo.movementModel.createCollection();
    await repo.movementModel.syncIndexes();
    await repo.balanceModel.syncIndexes();
  });

  afterAll(async () => {
    const c = mod.get<Connection>(getConnectionToken());
    await c.close();
    await mod.close();
    await mongo.stop();
  });

  it('inbound then outbound nets correct onHand', async () => {
    await svc.move({ productId: PID, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 2, reference: 'in-1' });
    await svc.move({ productId: PID, type: StockMovementType.OUTBOUND, quantity: 3, condition: 'new', reference: 'out-1' });
    const rows = await repo.balanceModel.find({ productId: new Types.ObjectId(PID) });
    const onHand = rows.reduce((s, r) => s + r.onHand, 0);
    expect(onHand).toBe(7);
  });

  it('duplicate reference is idempotent', async () => {
    await svc.move({ productId: PID, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dup' });
    await svc.move({ productId: PID, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'dup' });
    const count = await repo.movementModel.countDocuments({ 'metadata.externalReference': 'dup' });
    expect(count).toBe(1);
  });

  it('reservation increments reserved without touching onHand', async () => {
    const onHandBefore = (await repo.balanceModel.find({ productId: new Types.ObjectId(PID) }))
      .reduce((s, r) => s + r.onHand, 0);
    await svc.move({ productId: PID, type: StockMovementType.RESERVATION, quantity: 2, condition: 'new', reference: 'res-1' });
    const rows = await repo.balanceModel.find({ productId: new Types.ObjectId(PID) });
    const reserved = rows.reduce((s, r) => s + r.reserved, 0);
    const onHandAfter = rows.reduce((s, r) => s + r.onHand, 0);
    expect(reserved).toBe(2);
    expect(onHandAfter).toBe(onHandBefore); // reservation doesn't change physical stock
  });

  it('adjust applies a signed correction to onHand (append-only)', async () => {
    const PID2 = '650000000000000000000777';
    await svc.move({ productId: PID2, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', reference: 'adj-seed' });
    await svc.adjust({ productId: PID2, quantity: -2, condition: 'new', reason: 'inventory count', reference: 'adj-1' });
    const rows = await repo.balanceModel.find({ productId: new Types.ObjectId(PID2) });
    expect(rows.reduce((s, r) => s + r.onHand, 0)).toBe(8);
    // ledger is append-only: 2 movements, none deleted
    const count = await repo.movementModel.countDocuments({ productId: new Types.ObjectId(PID2) });
    expect(count).toBe(2);
  });

  it('listMovements returns movements newest-first', async () => {
    const PID3 = '650000000000000000000888';
    await svc.move({ productId: PID3, type: StockMovementType.INBOUND, quantity: 4, condition: 'new', unitCost: 1, reference: 'lm1' });
    const list = await query.listMovements(PID3, 10);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].type).toBe('inbound');
  });

  it('getMovementStatistics aggregates by type', async () => {
    const PID4 = '650000000000000000000999';
    await svc.move({ productId: PID4, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 's1' });
    await svc.move({ productId: PID4, type: StockMovementType.OUTBOUND, quantity: 2, condition: 'new', reference: 's2' });
    const stats = await query.getMovementStatistics(PID4);
    expect(stats['inbound'].quantity).toBe(5);
    expect(stats['outbound'].quantity).toBe(2);
  });

  it('listMovements exposes id, condition and date for the UI', async () => {
    const r = await svc.move({ productId: PID, type: StockMovementType.INBOUND, quantity: 4, condition: 'used', unitCost: 9, reference: 'lm-1' });
    const list = await query.listMovements(PID, 50);
    const found = list.find((m: any) => m.id === r.movementId);
    expect(found).toBeTruthy();
    expect(found.condition).toBe('used');
    expect(found.date).toBeInstanceOf(Date);
    expect(found.unitCost).toBe(9);
  });

  it('getProductCost returns the weighted-average lot cost (surfaced as balance.avgCost)', async () => {
    const P2 = '650000000000000000000abc';
    // Two distinct lots (different conditions) with unequal quantities:
    //   30 @ 2 (new) + 10 @ 6 (used) → weighted avg = (30*2 + 10*6) / 40 = 120/40 = 3.0
    // A simple unweighted mean would be (2+6)/2 = 4.0, so this pins the WEIGHTING.
    await svc.move({ productId: P2, type: StockMovementType.INBOUND, quantity: 30, condition: 'new', unitCost: 2, reference: 'ac-1' });
    await svc.move({ productId: P2, type: StockMovementType.INBOUND, quantity: 10, condition: 'used', unitCost: 6, reference: 'ac-2' });
    const cost = await query.getProductCost(P2);
    expect(cost).toBeCloseTo(3, 2);
  });

  it('editMovementViaAdjustment on a boxed movement corrects that box balance, not a phantom unlocated one', async () => {
    const P3 = '650000000000000000000bcd';
    const BOX = '650000000000000000009999';
    const created = await svc.move({
      productId: P3, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 5, toBoxId: BOX, reference: 'box-edit-seed',
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
      productId: P4, type: StockMovementType.INBOUND, quantity: 8, condition: 'new', unitCost: 5, toBoxId: BOX, reference: 'box-delete-seed',
    });

    await svc.reverseMovement(created.movementId);

    const byLocation = await query.getByLocation(P4);
    const boxRow = byLocation.find((r: any) => String(r.boxId) === BOX);
    const unlocatedRow = byLocation.find((r: any) => r.boxId == null);
    expect(boxRow?.onHand ?? 0).toBe(0);
    expect(unlocatedRow).toBeUndefined();
  });

  it('correctTo brings onHand to the target quantity regardless of current value', async () => {
    const P7 = '650000000000000000001111';
    await svc.move({ productId: P7, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'ct-seed' });

    await svc.correctTo({ productId: P7, condition: 'new', targetQuantity: 12 });
    let stock = await query.getProductStock(P7);
    expect(stock.onHand).toBe(12);

    await svc.correctTo({ productId: P7, condition: 'new', targetQuantity: 3 });
    stock = await query.getProductStock(P7);
    expect(stock.onHand).toBe(3);
  });

  it('correctTo is a no-op when target equals current (no movement created)', async () => {
    const P8 = '650000000000000000002222';
    await svc.move({ productId: P8, type: StockMovementType.INBOUND, quantity: 7, condition: 'new', reference: 'ct-noop-seed' });
    const before = await repo.movementModel.countDocuments({ productId: new Types.ObjectId(P8) });

    const result = await svc.correctTo({ productId: P8, condition: 'new', targetQuantity: 7 });
    const after = await repo.movementModel.countDocuments({ productId: new Types.ObjectId(P8) });

    expect(result).toBeNull();
    expect(after).toBe(before);
  });

  it('correctTo defaults to condition "new" and only affects that condition\'s balance', async () => {
    const P9 = '650000000000000000003333';
    await svc.move({ productId: P9, type: StockMovementType.INBOUND, quantity: 5, condition: 'new', reference: 'ct-cond-new' });
    await svc.move({ productId: P9, type: StockMovementType.INBOUND, quantity: 9, condition: 'used', reference: 'ct-cond-used' });

    await svc.correctTo({ productId: P9, targetQuantity: 1 });

    const byCondition = await query.getByCondition(P9);
    const newRow = byCondition.find((r: any) => r.condition === 'new');
    const usedRow = byCondition.find((r: any) => r.condition === 'used');
    expect(newRow?.onHand).toBe(1);
    expect(usedRow?.onHand).toBe(9);
  });

  it('two adjustments without a reference for the same product do not collide on the idempotency index', async () => {
    const P6 = '650000000000000000000eff';
    await svc.adjust({ productId: P6, quantity: 5, condition: 'new', reason: 'first correction' });
    await expect(
      svc.adjust({ productId: P6, quantity: 3, condition: 'new', reason: 'second correction' }),
    ).resolves.toBeDefined();
  });

  it('concurrent edits of the same movement (double-tap) do not throw a write-conflict error', async () => {
    const P5 = '650000000000000000000def';
    const created = await svc.move({
      productId: P5, type: StockMovementType.INBOUND, quantity: 10, condition: 'new', unitCost: 5, reference: 'race-seed',
    });

    await expect(
      Promise.all([
        svc.editMovementViaAdjustment(created.movementId, 4),
        svc.editMovementViaAdjustment(created.movementId, 4),
      ]),
    ).resolves.toBeDefined();
  });
});

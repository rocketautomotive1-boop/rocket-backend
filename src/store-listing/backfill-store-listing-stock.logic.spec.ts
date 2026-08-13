import { Types } from 'mongoose';
import {
  backfillStock,
  backfillBalances,
  backfillMovements,
  StockLotRow,
  StockBalanceRow,
  StockMovementRow,
} from '../../scripts/backfill-store-listing-stock';

describe('backfillStock', () => {
  const FALLBACK_STORE_ID = '6a00000000000000000000f0';

  function makeLot(overrides: Partial<StockLotRow> = {}): StockLotRow {
    return {
      _id: new Types.ObjectId(),
      productId: new Types.ObjectId(),
      condition: 'new',
      unitCost: '10.50',
      createdByUserId: null,
      ...overrides,
    };
  }

  it('dry-run: counts without writing', async () => {
    const lot = makeLot();
    const storeListingService = { findByProductAndStore: jest.fn(), create: jest.fn() };
    const stockLotModel = { findOne: jest.fn(), create: jest.fn() };

    const summary = await backfillStock({
      lots: [lot],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      stockLotModel: stockLotModel as any,
      dryRun: true,
    });

    expect(summary.totalLots).toBe(1);
    expect(stockLotModel.create).not.toHaveBeenCalled();
    expect(summary.lotsWouldCreate).toBe(1);
    expect(summary.lotsCreated).toBe(0);
  });

  it('execute: creates a StoreListing when the product has stock but no prior listing', async () => {
    const lot = makeLot();
    const storeListingService = {
      findByProductAndStore: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'SL-NEW' }),
    };
    const stockLotModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'newlot1' }),
    };

    const summary = await backfillStock({
      lots: [lot],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      stockLotModel: stockLotModel as any,
      dryRun: false,
    });

    expect(storeListingService.create).toHaveBeenCalledWith(String(lot.productId), FALLBACK_STORE_ID);
    expect(stockLotModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ storeListingId: 'SL-NEW', originalLotId: lot._id, condition: 'new' }),
    );
    expect(summary.lotsCreated).toBe(1);
  });

  it('idempotent: skips a lot whose originalLotId already exists in the target collection', async () => {
    const lot = makeLot();
    const storeListingService = {
      findByProductAndStore: jest.fn().mockResolvedValue({ id: 'SL1' }),
      create: jest.fn(),
    };
    const stockLotModel = {
      findOne: jest.fn().mockResolvedValue({ _id: 'already-there' }),
      create: jest.fn(),
    };

    const summary = await backfillStock({
      lots: [lot],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      stockLotModel: stockLotModel as any,
      dryRun: false,
    });

    expect(stockLotModel.create).not.toHaveBeenCalled();
    expect(summary.lotsSkippedAlreadyMigrated).toBe(1);
  });
});

describe('backfillBalances', () => {
  const productId = new Types.ObjectId();
  const originalLotId = new Types.ObjectId();
  const newLotId = 'new-lot-1';
  const storeListingId = 'SL1';

  function makeBalance(overrides: Partial<StockBalanceRow> = {}): StockBalanceRow {
    return {
      _id: new Types.ObjectId(),
      lotId: originalLotId,
      productId,
      condition: 'new',
      boxId: null,
      onHand: 5,
      reserved: 1,
      ...overrides,
    };
  }

  it('normal create: translates lotId and storeListingId, creates document', async () => {
    const balance = makeBalance();
    const balanceModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'newbal1' }),
    };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map([[String(originalLotId), newLotId]]);

    const result = await backfillBalances({
      balances: [balance],
      storeListingIdByProductId,
      lotIdMap,
      balanceModel: balanceModel as any,
      dryRun: false,
    });

    expect(balanceModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storeListingId,
        lotId: newLotId,
        originalBalanceId: balance._id,
        condition: 'new',
        onHand: 5,
        reserved: 1,
      }),
    );
    expect(result.created).toBe(1);
    expect(result.total).toBe(1);
  });

  it('idempotent: skips a balance whose originalBalanceId already exists', async () => {
    const balance = makeBalance();
    const balanceModel = {
      findOne: jest.fn().mockResolvedValue({ _id: 'already-there' }),
      create: jest.fn(),
    };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map([[String(originalLotId), newLotId]]);

    const result = await backfillBalances({
      balances: [balance],
      storeListingIdByProductId,
      lotIdMap,
      balanceModel: balanceModel as any,
      dryRun: false,
    });

    expect(balanceModel.create).not.toHaveBeenCalled();
    expect(result.skippedAlreadyMigrated).toBe(1);
  });

  it('orphaned lotId: skips and counts when lotId is not in lotIdMap', async () => {
    const balance = makeBalance();
    const balanceModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map<string, string>();

    const result = await backfillBalances({
      balances: [balance],
      storeListingIdByProductId,
      lotIdMap,
      balanceModel: balanceModel as any,
      dryRun: false,
    });

    expect(balanceModel.create).not.toHaveBeenCalled();
    expect(result.skippedOrphanedLotId).toBe(1);
  });

  it('missing StoreListing for product: logs and skips without throwing', async () => {
    const balance = makeBalance();
    const balanceModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    const storeListingIdByProductId = new Map<string, string>();
    const lotIdMap = new Map([[String(originalLotId), newLotId]]);

    const result = await backfillBalances({
      balances: [balance],
      storeListingIdByProductId,
      lotIdMap,
      balanceModel: balanceModel as any,
      dryRun: false,
    });

    expect(balanceModel.create).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.created).toBe(0);
    expect(result.skippedMissingStoreListing).toBe(1);
  });

  it('dry-run: counts wouldCreate for a balance that resolves cleanly, without writing', async () => {
    const balance = makeBalance();
    const balanceModel = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn() };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map([[String(originalLotId), newLotId]]);

    const result = await backfillBalances({
      balances: [balance],
      storeListingIdByProductId,
      lotIdMap,
      balanceModel: balanceModel as any,
      dryRun: true,
    });

    expect(result.total).toBe(1);
    expect(balanceModel.create).not.toHaveBeenCalled();
    expect(result.wouldCreate).toBe(1);
    expect(result.created).toBe(0);
  });
});

describe('backfillMovements', () => {
  const productId = new Types.ObjectId();
  const originalLotId = new Types.ObjectId();
  const newLotId = 'new-lot-1';
  const storeListingId = 'SL1';

  function makeMovement(overrides: Partial<StockMovementRow> = {}): StockMovementRow {
    return {
      _id: new Types.ObjectId(),
      lotId: originalLotId,
      productId,
      type: 'entry',
      quantity: 3,
      date: new Date('2026-01-01'),
      condition: 'new',
      ...overrides,
    };
  }

  it('normal create: translates lotId and storeListingId, creates document', async () => {
    const movement = makeMovement();
    const movementModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'newmov1' }),
    };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map([[String(originalLotId), newLotId]]);

    const result = await backfillMovements({
      movements: [movement],
      storeListingIdByProductId,
      lotIdMap,
      movementModel: movementModel as any,
      dryRun: false,
    });

    expect(movementModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storeListingId,
        lotId: newLotId,
        originalMovementId: movement._id,
        type: 'entry',
        quantity: 3,
      }),
    );
    expect(result.created).toBe(1);
  });

  it('idempotent: skips a movement whose originalMovementId already exists', async () => {
    const movement = makeMovement();
    const movementModel = {
      findOne: jest.fn().mockResolvedValue({ _id: 'already-there' }),
      create: jest.fn(),
    };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map([[String(originalLotId), newLotId]]);

    const result = await backfillMovements({
      movements: [movement],
      storeListingIdByProductId,
      lotIdMap,
      movementModel: movementModel as any,
      dryRun: false,
    });

    expect(movementModel.create).not.toHaveBeenCalled();
    expect(result.skippedAlreadyMigrated).toBe(1);
  });

  it('orphaned lotId: skips and counts when a present lotId is not in lotIdMap', async () => {
    const movement = makeMovement();
    const movementModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map<string, string>();

    const result = await backfillMovements({
      movements: [movement],
      storeListingIdByProductId,
      lotIdMap,
      movementModel: movementModel as any,
      dryRun: false,
    });

    expect(movementModel.create).not.toHaveBeenCalled();
    expect(result.skippedOrphanedLotId).toBe(1);
  });

  it('movement with no lotId at all passes through untranslated', async () => {
    const movement = makeMovement({ lotId: undefined });
    const movementModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: 'newmov1' }),
    };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map<string, string>();

    const result = await backfillMovements({
      movements: [movement],
      storeListingIdByProductId,
      lotIdMap,
      movementModel: movementModel as any,
      dryRun: false,
    });

    expect(movementModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storeListingId,
        originalMovementId: movement._id,
      }),
    );
    const createdArg = movementModel.create.mock.calls[0][0];
    expect(createdArg.lotId).toBeUndefined();
    expect(result.created).toBe(1);
    expect(result.skippedOrphanedLotId).toBe(0);
  });

  it('missing StoreListing for product: logs and skips without throwing', async () => {
    const movement = makeMovement();
    const movementModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    const storeListingIdByProductId = new Map<string, string>();
    const lotIdMap = new Map([[String(originalLotId), newLotId]]);

    const result = await backfillMovements({
      movements: [movement],
      storeListingIdByProductId,
      lotIdMap,
      movementModel: movementModel as any,
      dryRun: false,
    });

    expect(movementModel.create).not.toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.created).toBe(0);
    expect(result.skippedMissingStoreListing).toBe(1);
  });

  it('dry-run: counts wouldCreate for a movement that resolves cleanly, without writing', async () => {
    const movement = makeMovement();
    const movementModel = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn() };
    const storeListingIdByProductId = new Map([[String(productId), storeListingId]]);
    const lotIdMap = new Map([[String(originalLotId), newLotId]]);

    const result = await backfillMovements({
      movements: [movement],
      storeListingIdByProductId,
      lotIdMap,
      movementModel: movementModel as any,
      dryRun: true,
    });

    expect(result.total).toBe(1);
    expect(movementModel.create).not.toHaveBeenCalled();
    expect(result.wouldCreate).toBe(1);
    expect(result.created).toBe(0);
  });
});

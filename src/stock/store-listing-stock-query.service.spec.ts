import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { StoreListingStockQueryService } from './store-listing-stock-query.service';
import { STORE_OWNER_LOOKUP_PORT } from '../store-listing/ports/store-owner-lookup.port';
import { StoreListingModel } from '../store-listing/schemas/store-listing.schema';
import { StoreListingStockBalanceModel } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel } from '../store-listing/schemas/store-listing-stock-movement.schema';

describe('StoreListingStockQueryService', () => {
  let service: StoreListingStockQueryService;
  let storeOwnerLookup: { findStoreIdByProduct: jest.Mock };
  let storeListingModel: { aggregate: jest.Mock; findOne: jest.Mock };
  let balanceModel: { aggregate: jest.Mock };
  let movementModel: { aggregate: jest.Mock; countDocuments: jest.Mock; find: jest.Mock };

  const PRODUCT_A = new Types.ObjectId().toHexString();
  const STORE_A = new Types.ObjectId().toHexString();
  const STORE_LISTING_A = new Types.ObjectId().toHexString();

  beforeEach(async () => {
    storeOwnerLookup = { findStoreIdByProduct: jest.fn() };
    storeListingModel = { aggregate: jest.fn(), findOne: jest.fn() };
    balanceModel = { aggregate: jest.fn() };
    movementModel = { aggregate: jest.fn(), countDocuments: jest.fn(), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreListingStockQueryService,
        { provide: STORE_OWNER_LOOKUP_PORT, useValue: storeOwnerLookup },
        { provide: getModelToken(StoreListingModel.name), useValue: storeListingModel },
        { provide: getModelToken(StoreListingStockBalanceModel.name), useValue: balanceModel },
        { provide: getModelToken(StoreListingStockMovementModel.name), useValue: movementModel },
      ],
    }).compile();

    service = module.get(StoreListingStockQueryService);
  });

  // getProductStock/getByCondition/getByLocation/getProductCost/listMovements/getMovementStatistics/
  // getListingSnapshot are thin delegators: resolve the owning store via STORE_OWNER_LOOKUP_PORT,
  // then call the store-aware method below. Spying on those keeps this section decoupled from the
  // Mongo aggregation details already covered by the "store-aware reads" section.
  describe('bare productId reads (delegate to store-aware methods via STORE_OWNER_LOOKUP_PORT)', () => {
    it('getProductStock resolves the store and delegates to getStoreStockSummary', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      jest.spyOn(service, 'getStoreStockSummary').mockResolvedValue({ onHand: 5, reserved: 1, available: 4, avgCost: 10 });

      const result = await service.getProductStock(PRODUCT_A);

      expect(storeOwnerLookup.findStoreIdByProduct).toHaveBeenCalledWith(PRODUCT_A);
      expect(service.getStoreStockSummary).toHaveBeenCalledWith(PRODUCT_A, STORE_A);
      expect(result).toEqual({ productId: PRODUCT_A, onHand: 5, reserved: 1, available: 4 });
    });

    it('getProductStock returns zeroed stock (never throws) when the product has no StoreListing', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(null);
      const spy = jest.spyOn(service, 'getStoreStockSummary');

      const result = await service.getProductStock(PRODUCT_A);

      expect(spy).not.toHaveBeenCalled();
      expect(result).toEqual({ productId: PRODUCT_A, onHand: 0, reserved: 0, available: 0 });
    });

    it('getByCondition delegates to getStoreStockByCondition', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      jest.spyOn(service, 'getStoreStockByCondition').mockResolvedValue([{ condition: 'new', onHand: 3, reserved: 0 }]);

      expect(await service.getByCondition(PRODUCT_A)).toEqual([{ condition: 'new', onHand: 3, reserved: 0 }]);
      expect(service.getStoreStockByCondition).toHaveBeenCalledWith(PRODUCT_A, STORE_A);
    });

    it('getByCondition returns [] without a StoreListing', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(null);
      expect(await service.getByCondition(PRODUCT_A)).toEqual([]);
    });

    it('getByLocation delegates to getStoreStockByLocation', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      jest.spyOn(service, 'getStoreStockByLocation').mockResolvedValue([{ boxId: null, onHand: 3, reserved: 0 }]);

      expect(await service.getByLocation(PRODUCT_A)).toEqual([{ boxId: null, onHand: 3, reserved: 0 }]);
      expect(service.getStoreStockByLocation).toHaveBeenCalledWith(PRODUCT_A, STORE_A);
    });

    it('getProductCost resolves the store and returns avgCost from getStoreStockSummary', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      jest.spyOn(service, 'getStoreStockSummary').mockResolvedValue({ onHand: 5, reserved: 0, available: 5, avgCost: 42 });

      expect(await service.getProductCost(PRODUCT_A)).toBe(42);
    });

    it('getProductCost returns 0 without a StoreListing', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(null);
      expect(await service.getProductCost(PRODUCT_A)).toBe(0);
    });

    it('listMovements delegates to listStoreStockMovements', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      const mockMovements = [{ id: 'm1', type: 'inbound', quantity: 1, date: new Date(), condition: 'new' }];
      jest.spyOn(service, 'listStoreStockMovements').mockResolvedValue(mockMovements);

      const result = await service.listMovements(PRODUCT_A, 10);

      expect(service.listStoreStockMovements).toHaveBeenCalledWith(PRODUCT_A, STORE_A, 10);
      expect(result).toBe(mockMovements);
    });

    it('listMovements returns [] without a StoreListing', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(null);
      expect(await service.listMovements(PRODUCT_A)).toEqual([]);
    });

    it('getMovementStatistics delegates to getStoreStockMovementStatistics', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      jest.spyOn(service, 'getStoreStockMovementStatistics').mockResolvedValue({ inbound: { count: 1, quantity: 1 } });

      const result = await service.getMovementStatistics(PRODUCT_A);

      expect(service.getStoreStockMovementStatistics).toHaveBeenCalledWith(PRODUCT_A, STORE_A);
      expect(result).toEqual({ inbound: { count: 1, quantity: 1 } });
    });

    it('getMovementStatistics returns {} without a StoreListing', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(null);
      expect(await service.getMovementStatistics(PRODUCT_A)).toEqual({});
    });

    it('getListingSnapshot returns the most recent movement condition', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      jest.spyOn(service, 'listStoreStockMovements').mockResolvedValue([{ condition: 'used' } as any]);

      expect(await service.getListingSnapshot(PRODUCT_A)).toEqual({ condition: 'used' });
    });

    it('getListingSnapshot returns null without any movement', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(STORE_A);
      jest.spyOn(service, 'listStoreStockMovements').mockResolvedValue([]);

      expect(await service.getListingSnapshot(PRODUCT_A)).toBeNull();
    });
  });

  describe('getAvailableBulk', () => {
    it('starts from store_listings (filtered by productId) and returns available (onHand - reserved) per productId', async () => {
      const P2 = new Types.ObjectId().toHexString();
      storeListingModel.aggregate.mockResolvedValue([
        { _id: PRODUCT_A, onHand: 10, reserved: 2 },
        { _id: P2, onHand: 3, reserved: 3 },
      ]);

      const result = await service.getAvailableBulk([PRODUCT_A, P2]);

      expect(result.get(PRODUCT_A)).toBe(8);
      expect(result.get(P2)).toBe(0);
      const pipeline = storeListingModel.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({ $match: { productId: { $in: [new Types.ObjectId(PRODUCT_A), new Types.ObjectId(P2)] } } });
    });

    it('returns an empty map for an empty input', async () => {
      const result = await service.getAvailableBulk([]);
      expect(result.size).toBe(0);
      expect(storeListingModel.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('getProductIdsWithMinStock / getProductIdsWithMaxStock', () => {
    it('returns product ids whose aggregated onHand meets the minimum', async () => {
      balanceModel.aggregate.mockResolvedValue([{ _id: PRODUCT_A }]);

      const result = await service.getProductIdsWithMinStock(5);

      expect(result).toEqual([PRODUCT_A]);
    });

    it('returns product ids whose aggregated onHand is at or below the maximum', async () => {
      balanceModel.aggregate.mockResolvedValue([{ _id: PRODUCT_A }]);

      const result = await service.getProductIdsWithMaxStock(0);

      expect(result).toEqual([PRODUCT_A]);
    });
  });

  describe('referenceExists / findExistingReferences', () => {
    it('referenceExists checks store_listing_stock_movements by metadata.externalReference', async () => {
      movementModel.countDocuments.mockResolvedValue(1);

      expect(await service.referenceExists('ref-1')).toBe(true);
      expect(movementModel.countDocuments).toHaveBeenCalledWith({ 'metadata.externalReference': 'ref-1' });
    });

    it('findExistingReferences returns the subset that already exist', async () => {
      movementModel.find.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve([{ metadata: { externalReference: 'ref-1' } }]) }),
      });

      expect(await service.findExistingReferences(['ref-1', 'ref-2'])).toEqual(['ref-1']);
    });

    it('findExistingReferences returns [] for an empty input without querying', async () => {
      expect(await service.findExistingReferences([])).toEqual([]);
      expect(movementModel.find).not.toHaveBeenCalled();
    });
  });

  describe('store-aware reads (explicit storeId, authenticated inventory screen)', () => {
    const findOneChain = (doc: any) => ({ exec: jest.fn().mockResolvedValue(doc) });

    it('getStoreStockSummary resolves the StoreListing for (productId, storeId) and aggregates balances', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain({ _id: STORE_LISTING_A }));
      balanceModel.aggregate
        .mockResolvedValueOnce([{ _id: STORE_LISTING_A, onHand: 5, reserved: 1 }])
        .mockResolvedValueOnce([{ onHand: 5, unitCost: 10 }]);

      const result = await service.getStoreStockSummary(PRODUCT_A, STORE_A);

      expect(storeListingModel.findOne).toHaveBeenCalledWith({ productId: PRODUCT_A, storeId: STORE_A });
      expect(result).toEqual({ onHand: 5, reserved: 1, available: 4, avgCost: 10 });
    });

    it('getStoreStockSummary returns zeroed stock without a StoreListing for that store', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain(null));

      expect(await service.getStoreStockSummary(PRODUCT_A, STORE_A)).toEqual({
        onHand: 0,
        reserved: 0,
        available: 0,
        avgCost: 0,
      });
    });

    it('getStoreStockByCondition groups balances by condition for the resolved StoreListing', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain({ _id: STORE_LISTING_A }));
      balanceModel.aggregate.mockResolvedValue([{ condition: 'new', onHand: 3, reserved: 0 }]);

      expect(await service.getStoreStockByCondition(PRODUCT_A, STORE_A)).toEqual([
        { condition: 'new', onHand: 3, reserved: 0 },
      ]);
    });

    it('getStoreStockByCondition returns [] without a StoreListing for that store', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain(null));
      expect(await service.getStoreStockByCondition(PRODUCT_A, STORE_A)).toEqual([]);
    });

    it('getStoreStockByLocation groups balances by boxId for the resolved StoreListing', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain({ _id: STORE_LISTING_A }));
      balanceModel.aggregate.mockResolvedValue([{ boxId: null, onHand: 3, reserved: 0 }]);

      expect(await service.getStoreStockByLocation(PRODUCT_A, STORE_A)).toEqual([
        { boxId: null, onHand: 3, reserved: 0 },
      ]);
    });

    it('listStoreStockMovements returns the most recent movements for the resolved StoreListing', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain({ _id: STORE_LISTING_A }));
      movementModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          { _id: 'm1', type: 'inbound', quantity: 2, date: new Date('2026-08-01'), condition: 'new' },
        ]),
      });

      const result = await service.listStoreStockMovements(PRODUCT_A, STORE_A, 10);

      expect(result).toEqual([
        expect.objectContaining({ id: 'm1', type: 'inbound', quantity: 2, condition: 'new' }),
      ]);
    });

    it('listStoreStockMovements returns [] without a StoreListing for that store', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain(null));
      expect(await service.listStoreStockMovements(PRODUCT_A, STORE_A)).toEqual([]);
    });

    it('getStoreStockMovementStatistics groups movements by type for the resolved StoreListing', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain({ _id: STORE_LISTING_A }));
      movementModel.aggregate.mockResolvedValue([{ _id: 'inbound', count: 2, quantity: 5 }]);

      expect(await service.getStoreStockMovementStatistics(PRODUCT_A, STORE_A)).toEqual({
        inbound: { count: 2, quantity: 5 },
      });
    });

    it('getStoreStockMovementStatistics returns {} without a StoreListing for that store', async () => {
      storeListingModel.findOne.mockReturnValue(findOneChain(null));
      expect(await service.getStoreStockMovementStatistics(PRODUCT_A, STORE_A)).toEqual({});
    });
  });
});

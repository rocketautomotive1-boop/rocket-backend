import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { StoreListingStockQueryService } from './store-listing-stock-query.service';
import { STORE_LISTING_PORT, StoreListingPort } from '../store-listing/ports/store-listing.port';
import { StoreListingModel } from '../store-listing/schemas/store-listing.schema';
import { StoreListingStockBalanceModel } from '../store-listing/schemas/store-listing-stock-balance.schema';
import { StoreListingStockMovementModel } from '../store-listing/schemas/store-listing-stock-movement.schema';

describe('StoreListingStockQueryService', () => {
  let service: StoreListingStockQueryService;
  let storeListingPort: {
    findAnyByProduct: jest.Mock;
    getStockSummary: jest.Mock;
    getStockByCondition: jest.Mock;
    getStockByLocation: jest.Mock;
    listStockMovements: jest.Mock;
    getStockMovementStatistics: jest.Mock;
  };
  let storeListingModel: { aggregate: jest.Mock };
  let balanceModel: { aggregate: jest.Mock };
  let movementModel: { aggregate: jest.Mock; countDocuments: jest.Mock; find: jest.Mock };

  const PRODUCT_A = new Types.ObjectId().toHexString();
  const STORE_A = new Types.ObjectId().toHexString();
  const STORE_LISTING_A = new Types.ObjectId().toHexString();

  beforeEach(async () => {
    storeListingPort = {
      findAnyByProduct: jest.fn(),
      getStockSummary: jest.fn(),
      getStockByCondition: jest.fn(),
      getStockByLocation: jest.fn(),
      listStockMovements: jest.fn(),
      getStockMovementStatistics: jest.fn(),
    };
    storeListingModel = { aggregate: jest.fn() };
    balanceModel = { aggregate: jest.fn() };
    movementModel = { aggregate: jest.fn(), countDocuments: jest.fn(), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreListingStockQueryService,
        { provide: STORE_LISTING_PORT, useValue: storeListingPort },
        { provide: getModelToken(StoreListingModel.name), useValue: storeListingModel },
        { provide: getModelToken(StoreListingStockBalanceModel.name), useValue: balanceModel },
        { provide: getModelToken(StoreListingStockMovementModel.name), useValue: movementModel },
      ],
    }).compile();

    service = module.get(StoreListingStockQueryService);
  });

  describe('getProductStock', () => {
    it('resolves the owning store via findAnyByProduct and delegates to getStockSummary', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue({ id: STORE_LISTING_A, storeId: STORE_A });
      storeListingPort.getStockSummary.mockResolvedValue({ onHand: 5, reserved: 1, available: 4, avgCost: 10 });

      const result = await service.getProductStock(PRODUCT_A);

      expect(storeListingPort.findAnyByProduct).toHaveBeenCalledWith(PRODUCT_A);
      expect(storeListingPort.getStockSummary).toHaveBeenCalledWith(PRODUCT_A, STORE_A);
      expect(result).toEqual({ productId: PRODUCT_A, onHand: 5, reserved: 1, available: 4 });
    });

    it('returns zeroed stock (never throws) when the product has no StoreListing', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue(null);

      const result = await service.getProductStock(PRODUCT_A);

      expect(storeListingPort.getStockSummary).not.toHaveBeenCalled();
      expect(result).toEqual({ productId: PRODUCT_A, onHand: 0, reserved: 0, available: 0 });
    });
  });

  describe('getByCondition / getByLocation', () => {
    it('delegates getByCondition to the resolved store', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue({ id: STORE_LISTING_A, storeId: STORE_A });
      storeListingPort.getStockByCondition.mockResolvedValue([{ condition: 'new', onHand: 3, reserved: 0 }]);

      const result = await service.getByCondition(PRODUCT_A);

      expect(storeListingPort.getStockByCondition).toHaveBeenCalledWith(PRODUCT_A, STORE_A);
      expect(result).toEqual([{ condition: 'new', onHand: 3, reserved: 0 }]);
    });

    it('getByCondition returns [] without a StoreListing', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue(null);

      expect(await service.getByCondition(PRODUCT_A)).toEqual([]);
      expect(storeListingPort.getStockByCondition).not.toHaveBeenCalled();
    });

    it('delegates getByLocation to the resolved store', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue({ id: STORE_LISTING_A, storeId: STORE_A });
      storeListingPort.getStockByLocation.mockResolvedValue([{ boxId: null, onHand: 3, reserved: 0 }]);

      const result = await service.getByLocation(PRODUCT_A);

      expect(storeListingPort.getStockByLocation).toHaveBeenCalledWith(PRODUCT_A, STORE_A);
      expect(result).toEqual([{ boxId: null, onHand: 3, reserved: 0 }]);
    });
  });

  describe('getAvailableBulk', () => {
    it('joins store_listings to balances and returns available (onHand - reserved) per productId', async () => {
      const P2 = new Types.ObjectId().toHexString();
      balanceModel.aggregate.mockResolvedValue([
        { _id: PRODUCT_A, onHand: 10, reserved: 2 },
        { _id: P2, onHand: 3, reserved: 3 },
      ]);

      const result = await service.getAvailableBulk([PRODUCT_A, P2]);

      expect(result.get(PRODUCT_A)).toBe(8);
      expect(result.get(P2)).toBe(0);
    });

    it('returns an empty map for an empty input', async () => {
      const result = await service.getAvailableBulk([]);
      expect(result.size).toBe(0);
      expect(balanceModel.aggregate).not.toHaveBeenCalled();
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

  describe('getProductCost', () => {
    it('resolves the owning store and returns weighted-average cost', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue({ id: STORE_LISTING_A, storeId: STORE_A });
      storeListingPort.getStockSummary.mockResolvedValue({ onHand: 5, reserved: 0, available: 5, avgCost: 42 });

      const result = await service.getProductCost(PRODUCT_A);

      expect(result).toBe(42);
    });

    it('returns 0 without a StoreListing', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue(null);

      expect(await service.getProductCost(PRODUCT_A)).toBe(0);
    });
  });

  describe('listMovements / getMovementStatistics / getListingSnapshot', () => {
    it('delegates listMovements to the port with the resolved store', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue({ id: STORE_LISTING_A, storeId: STORE_A });
      const mockMovements = [{ id: 'm1', type: 'inbound', quantity: 1, date: new Date(), condition: 'new' as const }];
      storeListingPort.listStockMovements.mockResolvedValue(mockMovements);

      const result = await service.listMovements(PRODUCT_A, 10);

      expect(storeListingPort.listStockMovements).toHaveBeenCalledWith(PRODUCT_A, STORE_A, 10);
      expect(result).toBe(mockMovements);
    });

    it('listMovements returns [] without a StoreListing', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue(null);
      expect(await service.listMovements(PRODUCT_A)).toEqual([]);
    });

    it('delegates getMovementStatistics to the port with the resolved store', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue({ id: STORE_LISTING_A, storeId: STORE_A });
      storeListingPort.getStockMovementStatistics.mockResolvedValue({ inbound: { count: 1, quantity: 1 } });

      const result = await service.getMovementStatistics(PRODUCT_A);

      expect(storeListingPort.getStockMovementStatistics).toHaveBeenCalledWith(PRODUCT_A, STORE_A);
      expect(result).toEqual({ inbound: { count: 1, quantity: 1 } });
    });

    it('getMovementStatistics returns {} without a StoreListing', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue(null);
      expect(await service.getMovementStatistics(PRODUCT_A)).toEqual({});
    });

    it('getListingSnapshot returns the most recent movement condition', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue({ id: STORE_LISTING_A, storeId: STORE_A });
      storeListingPort.listStockMovements.mockResolvedValue([{ condition: 'used' }]);

      expect(await service.getListingSnapshot(PRODUCT_A)).toEqual({ condition: 'used' });
    });

    it('getListingSnapshot returns null without any movement', async () => {
      storeListingPort.findAnyByProduct.mockResolvedValue({ id: STORE_LISTING_A, storeId: STORE_A });
      storeListingPort.listStockMovements.mockResolvedValue([]);

      expect(await service.getListingSnapshot(PRODUCT_A)).toBeNull();
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
});

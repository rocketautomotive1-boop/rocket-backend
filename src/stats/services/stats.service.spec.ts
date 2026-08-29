import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { StatsService } from './stats.service';
import { ProductModel } from '../../product/schemas/product.schema';
import { StoreListingStockMovementModel } from '../../store-listing/schemas/store-listing-stock-movement.schema';
import { ListingModel } from '../../listing/schemas/listing.schema';

describe('StatsService — inventory value (Contract: lê store_listing_stock_movements, não o legado)', () => {
  let service: StatsService;
  let productModel: any;
  let movementModel: { aggregate: jest.Mock };
  let listingModel: { aggregate: jest.Mock };
  let allocationModel: { find: jest.Mock };

  beforeEach(async () => {
    productModel = {};
    movementModel = { aggregate: jest.fn() };
    listingModel = { aggregate: jest.fn() };
    allocationModel = { find: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StatsService,
        { provide: getModelToken(ProductModel.name), useValue: productModel },
        { provide: getModelToken(StoreListingStockMovementModel.name), useValue: movementModel },
        { provide: getModelToken(ListingModel.name), useValue: listingModel },
        { provide: getModelToken('AllocationModel'), useValue: allocationModel },
      ],
    }).compile();

    service = moduleRef.get(StatsService);
  });

  describe('getInventoryValueByAllocation', () => {
    it('agrega totalValue usando metadata.salePrice via lookup em store_listings', async () => {
      allocationModel.find.mockReturnValue({
        exec: async () => [{ boxes: [{ products: ['695688d51946eec2b3b6f04b'] }] }],
      });
      movementModel.aggregate.mockResolvedValue([{ totalValue: 150, totalQuantity: 10, productCount: 1 }]);

      const result = await service.getInventoryValueByAllocation({});

      expect(result).toEqual({ totalValue: 150, totalQuantity: 10, productCount: 1 });
      const pipeline = movementModel.aggregate.mock.calls[0][0];
      // Deve fazer lookup em store_listings para resolver productId a partir de storeListingId.
      expect(JSON.stringify(pipeline)).toContain('store_listings');
      expect(JSON.stringify(pipeline)).toContain('salePrice');
    });

    it('retorna zerado sem chamar aggregate quando nenhuma allocation corresponde aos filtros', async () => {
      allocationModel.find.mockReturnValue({ exec: async () => [] });

      const result = await service.getInventoryValueByAllocation({ andar: '2' });

      expect(result).toEqual({ totalValue: 0, totalQuantity: 0, productCount: 0 });
      expect(movementModel.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('getInventoryValue', () => {
    it('agrega totalValue por metadata.salePrice, sinal por type (inbound soma, resto subtrai)', async () => {
      listingModel.aggregate.mockResolvedValue([{ _id: '695688d51946eec2b3b6f04b' }]);
      movementModel.aggregate.mockResolvedValue([{ totalValue: 500, totalQuantity: 20, productCount: 1 }]);

      const result = await service.getInventoryValue('all');

      expect(result.totalValue).toBe(500);
      expect(result.totalQuantity).toBe(20);
      expect(result.productCount).toBe(1);
      const pipeline = movementModel.aggregate.mock.calls[0][0];
      expect(JSON.stringify(pipeline)).toContain('salePrice');
    });

    it('retorna zerado sem chamar aggregate quando não há produtos publicados', async () => {
      listingModel.aggregate.mockResolvedValue([]);

      const result = await service.getInventoryValue('all');

      expect(result.totalValue).toBe(0);
      expect(movementModel.aggregate).not.toHaveBeenCalled();
    });
  });
});

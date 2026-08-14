import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductReadinessService } from './product-readiness.service';
import { ProductRepository } from '../product.repository';
import { STORE_LISTING_PORT } from '../../store-listing/ports/store-listing.port';
import { PRICING_PORT } from '../../pricing/ports/pricing.port';
import { ProductTitleService } from './product-title.service';

describe('ProductReadinessService.compute — inventory store-aware', () => {
  let service: ProductReadinessService;
  let productRepository: { findByIdClean: jest.Mock };
  let storeListingPort: { findAnyByProduct: jest.Mock; getStockSummary: jest.Mock };
  let pricing: { getBasePrice: jest.Mock };
  let productTitleService: { findByProductId: jest.Mock };

  const BASE_PRODUCT = {
    _id: 'P1',
    partNumber: 'ABC123',
    brand: { name: 'Bosch' },
    images: [{ url: 'x.jpg', status: 'active' }],
    category: 'freios',
    weight: '1',
    dimensions: { length: '1', width: '1', height: '1' },
  };

  beforeEach(async () => {
    productRepository = { findByIdClean: jest.fn().mockResolvedValue(BASE_PRODUCT) };
    storeListingPort = { findAnyByProduct: jest.fn(), getStockSummary: jest.fn() };
    pricing = { getBasePrice: jest.fn().mockResolvedValue(50) };
    productTitleService = { findByProductId: jest.fn().mockResolvedValue([{ id: 't1' }]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductReadinessService,
        { provide: ProductRepository, useValue: productRepository },
        { provide: STORE_LISTING_PORT, useValue: storeListingPort },
        { provide: PRICING_PORT, useValue: pricing },
        { provide: ProductTitleService, useValue: productTitleService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProductReadinessService);
  });

  it('inventory é false quando o produto não tem NENHUM StoreListing ainda (nenhuma loja com estoque)', async () => {
    storeListingPort.findAnyByProduct.mockResolvedValue(null);

    const result = await service.compute('P1');

    expect(storeListingPort.getStockSummary).not.toHaveBeenCalled();
    expect(result?.inventory).toBe(false);
    expect(result?.readyToPublish).toBe(false);
  });

  it('inventory é false quando a loja dona do produto não tem saldo próprio (onHand 0)', async () => {
    storeListingPort.findAnyByProduct.mockResolvedValue({ id: 'SL1', storeId: 'store-maxeshop' });
    storeListingPort.getStockSummary.mockResolvedValue({ onHand: 0, reserved: 0, available: 0, avgCost: 0 });

    const result = await service.compute('P1');

    expect(storeListingPort.getStockSummary).toHaveBeenCalledWith('P1', 'store-maxeshop');
    expect(result?.inventory).toBe(false);
  });

  it('inventory é true quando a loja dona do produto tem saldo próprio e preço', async () => {
    storeListingPort.findAnyByProduct.mockResolvedValue({ id: 'SL1', storeId: 'store-rocket' });
    storeListingPort.getStockSummary.mockResolvedValue({ onHand: 10, reserved: 0, available: 10, avgCost: 5 });

    const result = await service.compute('P1');

    expect(result?.inventory).toBe(true);
    expect(result?.readyToPublish).toBe(true);
  });

  it('inventory é false quando há estoque mas o preço base é zero', async () => {
    storeListingPort.findAnyByProduct.mockResolvedValue({ id: 'SL1', storeId: 'store-rocket' });
    storeListingPort.getStockSummary.mockResolvedValue({ onHand: 10, reserved: 0, available: 10, avgCost: 5 });
    pricing.getBasePrice.mockResolvedValue(0);

    const result = await service.compute('P1');

    expect(result?.inventory).toBe(false);
  });
});

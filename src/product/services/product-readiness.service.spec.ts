import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductReadinessService } from './product-readiness.service';
import { ProductRepository } from '../product.repository';
import { STORE_OWNER_LOOKUP_PORT } from '../../store-listing/ports/store-owner-lookup.port';
import { STORE_AWARE_STOCK_QUERY_PORT } from '../../stock/ports/stock-query.port';
import { PRICING_PORT } from '../../pricing/ports/pricing.port';
import { ProductTitleService } from './product-title.service';

describe('ProductReadinessService.compute — inventory store-aware', () => {
  let service: ProductReadinessService;
  let productRepository: { findByIdClean: jest.Mock };
  let storeOwnerLookup: { findStoreIdByProduct: jest.Mock };
  let stockQuery: { getStoreStockSummary: jest.Mock };
  let pricing: { getBasePrice: jest.Mock };
  let productTitleService: { findByProductId: jest.Mock; findByProductIdAndStore: jest.Mock };

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
    storeOwnerLookup = { findStoreIdByProduct: jest.fn() };
    stockQuery = { getStoreStockSummary: jest.fn() };
    pricing = { getBasePrice: jest.fn().mockResolvedValue(50) };
    productTitleService = {
      findByProductId: jest.fn().mockResolvedValue([{ id: 't1' }]),
      findByProductIdAndStore: jest.fn().mockResolvedValue([{ id: 't1' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductReadinessService,
        { provide: ProductRepository, useValue: productRepository },
        { provide: STORE_OWNER_LOOKUP_PORT, useValue: storeOwnerLookup },
        { provide: STORE_AWARE_STOCK_QUERY_PORT, useValue: stockQuery },
        { provide: PRICING_PORT, useValue: pricing },
        { provide: ProductTitleService, useValue: productTitleService },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProductReadinessService);
  });

  it('inventory é false quando o produto não tem NENHUM StoreListing ainda (nenhuma loja com estoque)', async () => {
    storeOwnerLookup.findStoreIdByProduct.mockResolvedValue(null);

    const result = await service.compute('P1');

    expect(stockQuery.getStoreStockSummary).not.toHaveBeenCalled();
    expect(result?.inventory).toBe(false);
    expect(result?.readyToPublish).toBe(false);
  });

  it('inventory é false quando a loja dona do produto não tem saldo próprio (onHand 0)', async () => {
    storeOwnerLookup.findStoreIdByProduct.mockResolvedValue('store-maxeshop');
    stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 0, reserved: 0, available: 0, avgCost: 0 });

    const result = await service.compute('P1');

    expect(stockQuery.getStoreStockSummary).toHaveBeenCalledWith('P1', 'store-maxeshop');
    expect(result?.inventory).toBe(false);
  });

  it('inventory é true quando a loja dona do produto tem saldo próprio e preço', async () => {
    storeOwnerLookup.findStoreIdByProduct.mockResolvedValue('store-rocket');
    stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 10, reserved: 0, available: 10, avgCost: 5 });

    const result = await service.compute('P1');

    expect(result?.inventory).toBe(true);
    expect(result?.readyToPublish).toBe(true);
  });

  it('inventory é false quando há estoque mas o preço base é zero', async () => {
    storeOwnerLookup.findStoreIdByProduct.mockResolvedValue('store-rocket');
    stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 10, reserved: 0, available: 10, avgCost: 5 });
    pricing.getBasePrice.mockResolvedValue(0);

    const result = await service.compute('P1');

    expect(result?.inventory).toBe(false);
  });

  describe('com storeId explícito (usuário logado) — não usa findStoreIdByProduct nem outra loja', () => {
    it('regressão: produto com StoreListing vazio numa loja mais antiga e saldo real noutra — storeId explícito ignora a mais antiga', async () => {
      // Reproduz o bug real: findStoreIdByProduct pegaria sempre o StoreListing mais antigo
      // (Rocket, vazio); com storeId explícito de MAXESHOP, nunca deve nem chamar
      // findStoreIdByProduct — vai direto no saldo da loja pedida.
      stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 1, reserved: 0, available: 1, avgCost: 5 });

      const result = await service.compute('P1', 'store-maxeshop');

      expect(storeOwnerLookup.findStoreIdByProduct).not.toHaveBeenCalled();
      expect(stockQuery.getStoreStockSummary).toHaveBeenCalledWith('P1', 'store-maxeshop');
      expect(result?.inventory).toBe(true);
    });

    it('inventory é false quando a loja pedida não tem saldo, mesmo que outra loja do produto tenha', async () => {
      stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 0, reserved: 0, available: 0, avgCost: 0 });

      const result = await service.compute('P1', 'store-rocket-vazia');

      expect(result?.inventory).toBe(false);
    });
  });

  describe('titles store-aware — mesma regra do inventory', () => {
    it('com storeId explícito, usa findByProductIdAndStore (nunca findByProductId)', async () => {
      stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 1, reserved: 0, available: 1, avgCost: 5 });
      productTitleService.findByProductIdAndStore.mockResolvedValue([{ id: 't-maxeshop' }]);

      const result = await service.compute('P1', 'store-maxeshop');

      expect(productTitleService.findByProductIdAndStore).toHaveBeenCalledWith('P1', 'store-maxeshop');
      expect(productTitleService.findByProductId).not.toHaveBeenCalled();
      expect(result?.titles).toBe(true);
    });

    it('regressão: titles é false quando a loja pedida não tem título, mesmo que outra loja do produto tenha', async () => {
      stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 1, reserved: 0, available: 1, avgCost: 5 });
      productTitleService.findByProductIdAndStore.mockResolvedValue([]);

      const result = await service.compute('P1', 'store-sem-titulo');

      expect(result?.titles).toBe(false);
      expect(result?.readyToPublish).toBe(false);
    });

    it('sem storeId (gate de publish/listener), mantém comportamento anterior via findByProductId', async () => {
      storeOwnerLookup.findStoreIdByProduct.mockResolvedValue('store-rocket');
      stockQuery.getStoreStockSummary.mockResolvedValue({ onHand: 1, reserved: 0, available: 1, avgCost: 5 });

      const result = await service.compute('P1');

      expect(productTitleService.findByProductId).toHaveBeenCalledWith('P1');
      expect(productTitleService.findByProductIdAndStore).not.toHaveBeenCalled();
      expect(result?.titles).toBe(true);
    });
  });
});

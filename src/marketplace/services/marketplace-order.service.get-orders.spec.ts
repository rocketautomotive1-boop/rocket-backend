import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { forwardRef } from '@nestjs/common';
import { MarketplaceOrderService } from './marketplace-order.service';
import { MarketplaceRegistryService } from './marketplace-registry.service';
import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { OrderModel } from '../../order/schemas/order.schema';
import { ProductService } from '../../product/product.service';
import { ProductRepository } from '../../product/product.repository';
import { IgnoredOrderModel } from '../schemas/ignored-order.schema';
import { ListingService } from '../../listing/listing.service';
import { STORE_PORT } from '../../store/ports/store.port';

/**
 * getAllOrders/getOrders leem SÓ do banco local (Order collection) — nunca ao vivo
 * via adapter.getOrders(). Ver docs/superpowers/specs/2026-08-26-order-list-single-source-design.md.
 */
describe('MarketplaceOrderService — leitura de listagem via banco local', () => {
  let service: MarketplaceOrderService;
  let orderModel: { find: jest.Mock };
  let registryService: { findOne: jest.Mock };
  let adapterRegistry: { getOrderAdapter: jest.Mock; hasOrderAdapter: jest.Mock };
  let storePort: { findById: jest.Mock; resolveAccountIds: jest.Mock };

  const buildQueryChain = (docs: any[]) => ({
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(docs),
  });

  beforeEach(async () => {
    orderModel = { find: jest.fn() };
    registryService = { findOne: jest.fn() };
    adapterRegistry = { getOrderAdapter: jest.fn(), hasOrderAdapter: jest.fn() };
    storePort = { findById: jest.fn(), resolveAccountIds: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceOrderService,
        { provide: MarketplaceRegistryService, useValue: registryService },
        { provide: MarketplaceAdapterRegistry, useValue: adapterRegistry },
        { provide: MarketplaceAuthService, useValue: {} },
        { provide: getModelToken(OrderModel.name), useValue: orderModel },
        { provide: ProductService, useValue: {} },
        { provide: ProductRepository, useValue: {} },
        { provide: getModelToken(IgnoredOrderModel.name), useValue: {} },
        { provide: ListingService, useValue: {} },
        { provide: STORE_PORT, useValue: storePort },
      ],
    })
      .overrideProvider(forwardRef(() => ProductService) as any)
      .useValue({})
      .compile();

    service = moduleRef.get(MarketplaceOrderService);
  });

  describe('getAllOrders', () => {
    it('nunca chama adapter.getOrders() — lê só do OrderModel escopado por accountIds da loja', async () => {
      storePort.findById.mockResolvedValue({
        marketplaceAccounts: [{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A' }],
      });
      const doc = { _id: 'o1', externalId: '2000018', status: 'paid', marketplaceId: 'mkt-1', customer: { name: 'Maria' }, items: [] };
      orderModel.find.mockReturnValue(buildQueryChain([doc]));

      const result = await service.getAllOrders('store-1');

      expect(storePort.findById).toHaveBeenCalledWith('store-1');
      expect(orderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: { $in: ['ACC_A'] } }),
      );
      expect(adapterRegistry.getOrderAdapter).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2000018');
    });

    it('retorna [] sem consultar o Mongo quando a loja não tem contas mapeadas', async () => {
      storePort.findById.mockResolvedValue({ marketplaceAccounts: [] });

      const result = await service.getAllOrders('store-1');

      expect(result).toEqual([]);
      expect(orderModel.find).not.toHaveBeenCalled();
    });

    it('repassa status/limit/offset/q como filtro Mongo (status, $or de busca)', async () => {
      storePort.findById.mockResolvedValue({
        marketplaceAccounts: [{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A' }],
      });
      orderModel.find.mockReturnValue(buildQueryChain([]));

      await service.getAllOrders('store-1', { status: 'paid', limit: 10, offset: 5, q: 'joao' });

      expect(orderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: { $in: ['ACC_A'] },
          status: 'paid',
          $or: expect.any(Array),
        }),
      );
    });
  });

  describe('getOrders (por marketplace)', () => {
    it('resolve accountIds só da tag do marketplace e filtra por marketplaceId', async () => {
      registryService.findOne.mockResolvedValue({ _id: 'mkt-1', name: 'Mercado Livre', tag: 'mercadolivre' });
      storePort.resolveAccountIds.mockResolvedValue(['ACC_A']);
      orderModel.find.mockReturnValue(buildQueryChain([]));

      await service.getOrders('mkt-1', 'store-1', { status: 'shipped' });

      expect(storePort.resolveAccountIds).toHaveBeenCalledWith('store-1', 'mercadolivre');
      expect(orderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: { $in: ['ACC_A'] }, marketplaceId: 'mkt-1', status: 'shipped' }),
      );
      expect(adapterRegistry.getOrderAdapter).not.toHaveBeenCalled();
    });

    it('retorna [] sem consultar o Mongo quando não há conta mapeada para a tag', async () => {
      registryService.findOne.mockResolvedValue({ _id: 'mkt-1', name: 'Mercado Livre', tag: 'mercadolivre' });
      storePort.resolveAccountIds.mockResolvedValue([]);

      const result = await service.getOrders('mkt-1', 'store-1');

      expect(result).toEqual([]);
      expect(orderModel.find).not.toHaveBeenCalled();
    });
  });
});

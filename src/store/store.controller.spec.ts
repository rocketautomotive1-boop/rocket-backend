import { Test } from '@nestjs/testing';
import { StoreController } from './store.controller';
import { StoreService } from './services/store.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('StoreController', () => {
  let controller: StoreController;
  let storeService: jest.Mocked<Pick<StoreService, 'findAll' | 'setMarketplaceAccount' | 'removeMarketplaceAccount' | 'create'>>;
  let configCache: jest.Mocked<Pick<MarketplaceConfigCacheService, 'getAll'>>;

  beforeEach(async () => {
    storeService = {
      findAll: jest.fn(),
      setMarketplaceAccount: jest.fn(),
      removeMarketplaceAccount: jest.fn(),
      create: jest.fn(),
    };
    configCache = {
      getAll: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [StoreController],
      providers: [
        { provide: StoreService, useValue: storeService },
        { provide: MarketplaceConfigCacheService, useValue: configCache },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(StoreController);
  });

  it('list: resolve accountLabel para CADA conta da loja, incluindo N contas do mesmo marketplace', async () => {
    storeService.findAll.mockResolvedValue([
      {
        id: 'S1',
        name: 'RCK_AUTOMOTIVE',
        marketplaceAccounts: [
          { marketplaceTag: 'mercadolivre', accountId: 'ACC_1' },
          { marketplaceTag: 'mercadolivre', accountId: 'ACC_2' },
        ],
      } as any,
    ]);
    configCache.getAll.mockResolvedValue([
      {
        tag: 'mercadolivre',
        accounts: [
          { _id: 'ACC_1', label: 'RCK_AUTOMOTIVE Principal' },
          { _id: 'ACC_2', label: 'RCK_AUTOMOTIVE B2B' },
        ],
      } as any,
    ]);

    const result = await controller.list();

    expect(result).toEqual([
      {
        storeId: 'S1',
        name: 'RCK_AUTOMOTIVE',
        accounts: [
          { marketplaceTag: 'mercadolivre', accountId: 'ACC_1', accountLabel: 'RCK_AUTOMOTIVE Principal' },
          { marketplaceTag: 'mercadolivre', accountId: 'ACC_2', accountLabel: 'RCK_AUTOMOTIVE B2B' },
        ],
      },
    ]);
  });

  it('setMarketplaceAccount: passa storeId, marketplaceTag e accountId (da URL) ao service', async () => {
    await controller.setMarketplaceAccount('S1', 'mercadolivre', 'ACC_1');
    expect(storeService.setMarketplaceAccount).toHaveBeenCalledWith('S1', 'mercadolivre', 'ACC_1');
  });

  it('removeMarketplaceAccount: passa storeId, marketplaceTag e accountId (da URL) ao service', async () => {
    await controller.removeMarketplaceAccount('S1', 'mercadolivre', 'ACC_1');
    expect(storeService.removeMarketplaceAccount).toHaveBeenCalledWith('S1', 'mercadolivre', 'ACC_1');
  });

  it('create: delega ao service e retorna storeId/name', async () => {
    storeService.create.mockResolvedValue({ id: 'S1', name: 'Loja Nova', marketplaceAccounts: [] } as any);
    const result = await controller.create({ name: 'Loja Nova' });
    expect(result).toEqual({ storeId: 'S1', name: 'Loja Nova' });
  });
});

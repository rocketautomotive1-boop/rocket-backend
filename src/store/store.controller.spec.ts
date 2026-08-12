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

  it('list: resolve accountLabel cruzando accounts da loja com marketplaces.accounts[]', async () => {
    storeService.findAll.mockResolvedValue([
      { id: 'S1', name: 'RCK_AUTOMOTIVE', accounts: { mercadolivre: 'ACC_1' } } as any,
    ]);
    configCache.getAll.mockResolvedValue([
      { tag: 'mercadolivre', accounts: [{ _id: 'ACC_1', label: 'RCK_AUTOMOTIVE' }] } as any,
    ]);

    const result = await controller.list();

    expect(result).toEqual([
      {
        storeId: 'S1',
        name: 'RCK_AUTOMOTIVE',
        accounts: [{ marketplaceTag: 'mercadolivre', accountId: 'ACC_1', accountLabel: 'RCK_AUTOMOTIVE' }],
      },
    ]);
  });

  it('list: accountLabel null quando a conta referenciada não existe mais no marketplace', async () => {
    storeService.findAll.mockResolvedValue([
      { id: 'S1', name: 'Max Eshop', accounts: { mercadolivre: 'ACC_DELETED' } } as any,
    ]);
    configCache.getAll.mockResolvedValue([
      { tag: 'mercadolivre', accounts: [{ _id: 'ACC_1', label: 'Outra conta' }] } as any,
    ]);

    const result = await controller.list();

    expect(result[0].accounts[0].accountLabel).toBeNull();
  });

  it('listMarketplaceAccounts: só marketplaces com tag, contas mapeadas por marketplace', async () => {
    configCache.getAll.mockResolvedValue([
      { tag: 'mercadolivre', name: 'Mercado Livre', accounts: [{ _id: 'ACC_1', label: 'RCK' }] } as any,
      { tag: null, name: 'Sem tag', accounts: [] } as any,
    ]);

    const result = await controller.listMarketplaceAccounts();

    expect(result).toEqual([
      {
        marketplaceTag: 'mercadolivre',
        marketplaceName: 'Mercado Livre',
        accounts: [{ accountId: 'ACC_1', label: 'RCK' }],
      },
    ]);
  });

  it('create: delega ao StoreService', async () => {
    storeService.create.mockResolvedValue({ id: 'S1', name: 'Loja Nova', accounts: {} } as any);
    const result = await controller.create({ name: 'Loja Nova' });
    expect(result).toEqual({ storeId: 'S1', name: 'Loja Nova' });
  });

  it('setMarketplaceAccount: delega ao StoreService com accountId trimado', async () => {
    await controller.setMarketplaceAccount('S1', 'mercadolivre', { accountId: '  ACC_1  ' });
    expect(storeService.setMarketplaceAccount).toHaveBeenCalledWith('S1', 'mercadolivre', 'ACC_1');
  });

  it('setMarketplaceAccount: accountId vazio lança BadRequestException', async () => {
    await expect(
      controller.setMarketplaceAccount('S1', 'mercadolivre', { accountId: '  ' }),
    ).rejects.toThrow('accountId é obrigatório.');
  });

  it('removeMarketplaceAccount: delega ao StoreService', async () => {
    await controller.removeMarketplaceAccount('S1', 'mercadolivre');
    expect(storeService.removeMarketplaceAccount).toHaveBeenCalledWith('S1', 'mercadolivre');
  });
});

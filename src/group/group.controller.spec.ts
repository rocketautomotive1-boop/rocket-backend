import { Test } from '@nestjs/testing';
import { GroupController } from './group.controller';
import { GroupService } from './services/group.service';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('GroupController', () => {
  let controller: GroupController;
  let groupService: jest.Mocked<Pick<GroupService, 'findAll' | 'setMarketplaceAccount'>>;
  let configCache: jest.Mocked<Pick<MarketplaceConfigCacheService, 'getAll'>>;

  beforeEach(async () => {
    groupService = {
      findAll: jest.fn(),
      setMarketplaceAccount: jest.fn(),
    };
    configCache = {
      getAll: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [GroupController],
      providers: [
        { provide: GroupService, useValue: groupService },
        { provide: MarketplaceConfigCacheService, useValue: configCache },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(GroupController);
  });

  it('list: resolve accountLabel cruzando accounts do grupo com marketplaces.accounts[]', async () => {
    groupService.findAll.mockResolvedValue([
      { id: 'G1', name: 'RCK_AUTOMOTIVE', accounts: { mercadolivre: 'ACC_1' } } as any,
    ]);
    configCache.getAll.mockResolvedValue([
      { tag: 'mercadolivre', accounts: [{ _id: 'ACC_1', label: 'RCK_AUTOMOTIVE' }] } as any,
    ]);

    const result = await controller.list();

    expect(result).toEqual([
      {
        groupId: 'G1',
        name: 'RCK_AUTOMOTIVE',
        accounts: [{ marketplaceTag: 'mercadolivre', accountId: 'ACC_1', accountLabel: 'RCK_AUTOMOTIVE' }],
      },
    ]);
  });

  it('list: accountLabel null quando a conta referenciada não existe mais no marketplace', async () => {
    groupService.findAll.mockResolvedValue([
      { id: 'G1', name: 'Max Eshop', accounts: { mercadolivre: 'ACC_DELETED' } } as any,
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

  it('setMarketplaceAccount: delega ao GroupService com accountId trimado', async () => {
    await controller.setMarketplaceAccount('G1', 'mercadolivre', { accountId: '  ACC_1  ' });
    expect(groupService.setMarketplaceAccount).toHaveBeenCalledWith('G1', 'mercadolivre', 'ACC_1');
  });

  it('setMarketplaceAccount: accountId vazio lança BadRequestException', async () => {
    await expect(
      controller.setMarketplaceAccount('G1', 'mercadolivre', { accountId: '  ' }),
    ).rejects.toThrow('accountId é obrigatório.');
  });
});

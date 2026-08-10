import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { GroupModel } from '../schemas/group.schema';
import { GroupService } from './group.service';

describe('GroupService', () => {
  const GROUP_ID = '6955b688dfe7143a30376c01';

  let service: GroupService;
  let modelMock: any;

  const groupDoc = (accounts: Record<string, string> = {}) => ({
    _id: GROUP_ID,
    name: 'Loja Centro',
    accounts,
  });

  beforeEach(async () => {
    modelMock = {
      find: jest.fn(),
      findById: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [GroupService, { provide: getModelToken(GroupModel.name), useValue: modelMock }],
    }).compile();

    service = moduleRef.get(GroupService);
  });

  it('resolveAccountId: sem groupId retorna null sem consultar o Mongo', async () => {
    const acc = await service.resolveAccountId(null, 'mercadolivre');
    expect(acc).toBeNull();
    expect(modelMock.find).not.toHaveBeenCalled();
  });

  it('resolveAccountId: grupo existe e tem a tag mapeada', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [groupDoc({ mercadolivre: 'ACC_A' })] }),
    });

    const acc = await service.resolveAccountId(GROUP_ID, 'mercadolivre');
    expect(acc).toBe('ACC_A');
  });

  it('resolveAccountId: grupo existe mas sem mapeamento para o marketplace', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [groupDoc({ shopee: 'ACC_B' })] }),
    });

    const acc = await service.resolveAccountId(GROUP_ID, 'mercadolivre');
    expect(acc).toBeNull();
  });

  it('resolveAccountId: grupo não existe', async () => {
    modelMock.find.mockReturnValue({ lean: () => ({ exec: async () => [] }) });

    const acc = await service.resolveAccountId(GROUP_ID, 'mercadolivre');
    expect(acc).toBeNull();
  });

  it('cache: uma segunda leitura não re-consulta o Mongo até invalidate()', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [groupDoc({ mercadolivre: 'ACC_A' })] }),
    });

    await service.resolveAccountId(GROUP_ID, 'mercadolivre');
    await service.resolveAccountId(GROUP_ID, 'mercadolivre');
    expect(modelMock.find).toHaveBeenCalledTimes(1);

    service.invalidate();
    await service.resolveAccountId(GROUP_ID, 'mercadolivre');
    expect(modelMock.find).toHaveBeenCalledTimes(2);
  });

  it('setMarketplaceAccount: grupo inexistente lança NotFoundException', async () => {
    modelMock.findById.mockReturnValue({ exec: async () => null });
    await expect(service.setMarketplaceAccount(GROUP_ID, 'mercadolivre', 'ACC_A')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('setMarketplaceAccount: grava e invalida o cache', async () => {
    const saved = { ...groupDoc(), accounts: {}, markModified: jest.fn(), save: jest.fn() };
    modelMock.findById.mockReturnValue({ exec: async () => saved });
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [groupDoc({ mercadolivre: 'ACC_A' })] }),
    });

    // Popula o cache antes da escrita.
    await service.resolveAccountId(GROUP_ID, 'mercadolivre');
    expect(modelMock.find).toHaveBeenCalledTimes(1);

    await service.setMarketplaceAccount(GROUP_ID, 'mercadolivre', 'ACC_A');
    expect(saved.accounts).toEqual({ mercadolivre: 'ACC_A' });
    expect(saved.save).toHaveBeenCalled();

    // Cache foi invalidado — próxima leitura re-consulta.
    await service.resolveAccountId(GROUP_ID, 'mercadolivre');
    expect(modelMock.find).toHaveBeenCalledTimes(2);
  });
});

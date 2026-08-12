import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { StoreModel } from '../schemas/store.schema';
import { StoreService } from './store.service';

describe('StoreService', () => {
  const STORE_ID = '6955b688dfe7143a30376c01';

  let service: StoreService;
  let modelMock: any;

  const storeDoc = (accounts: Record<string, string> = {}) => ({
    _id: STORE_ID,
    name: 'Loja Centro',
    accounts,
  });

  beforeEach(async () => {
    modelMock = {
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [StoreService, { provide: getModelToken(StoreModel.name), useValue: modelMock }],
    }).compile();

    service = moduleRef.get(StoreService);
  });

  it('resolveAccountId: sem storeId retorna null sem consultar o Mongo', async () => {
    const acc = await service.resolveAccountId(null, 'mercadolivre');
    expect(acc).toBeNull();
    expect(modelMock.find).not.toHaveBeenCalled();
  });

  it('resolveAccountId: loja existe e tem a tag mapeada', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [storeDoc({ mercadolivre: 'ACC_A' })] }),
    });

    const acc = await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(acc).toBe('ACC_A');
  });

  it('resolveAccountId: loja existe mas sem mapeamento para o marketplace', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [storeDoc({ shopee: 'ACC_B' })] }),
    });

    const acc = await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(acc).toBeNull();
  });

  it('resolveAccountId: loja não existe', async () => {
    modelMock.find.mockReturnValue({ lean: () => ({ exec: async () => [] }) });

    const acc = await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(acc).toBeNull();
  });

  it('cache: uma segunda leitura não re-consulta o Mongo até invalidate()', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [storeDoc({ mercadolivre: 'ACC_A' })] }),
    });

    await service.resolveAccountId(STORE_ID, 'mercadolivre');
    await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(modelMock.find).toHaveBeenCalledTimes(1);

    service.invalidate();
    await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(modelMock.find).toHaveBeenCalledTimes(2);
  });

  it('setMarketplaceAccount: loja inexistente lança NotFoundException', async () => {
    modelMock.findById.mockReturnValue({ exec: async () => null });
    await expect(service.setMarketplaceAccount(STORE_ID, 'mercadolivre', 'ACC_A')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('setMarketplaceAccount: grava e invalida o cache', async () => {
    const saved = { ...storeDoc(), accounts: {}, markModified: jest.fn(), save: jest.fn() };
    modelMock.findById.mockReturnValue({ exec: async () => saved });
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [storeDoc({ mercadolivre: 'ACC_A' })] }),
    });

    // Popula o cache antes da escrita.
    await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(modelMock.find).toHaveBeenCalledTimes(1);

    await service.setMarketplaceAccount(STORE_ID, 'mercadolivre', 'ACC_A');
    expect(saved.accounts).toEqual({ mercadolivre: 'ACC_A' });
    expect(saved.save).toHaveBeenCalled();

    // Cache foi invalidado — próxima leitura re-consulta.
    await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(modelMock.find).toHaveBeenCalledTimes(2);
  });

  it('removeMarketplaceAccount: loja inexistente lança NotFoundException', async () => {
    modelMock.findById.mockReturnValue({ exec: async () => null });
    await expect(service.removeMarketplaceAccount(STORE_ID, 'mercadolivre')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('removeMarketplaceAccount: remove a tag e invalida o cache', async () => {
    const saved = { ...storeDoc({ mercadolivre: 'ACC_A', shopee: 'ACC_B' }), markModified: jest.fn(), save: jest.fn() };
    modelMock.findById.mockReturnValue({ exec: async () => saved });

    await service.removeMarketplaceAccount(STORE_ID, 'mercadolivre');
    expect(saved.accounts).toEqual({ shopee: 'ACC_B' });
    expect(saved.save).toHaveBeenCalled();
  });

  it('create: valida name obrigatório', async () => {
    await expect(service.create('')).rejects.toThrow('name é obrigatório.');
  });

  it('create: cria a loja e invalida o cache', async () => {
    const created = { ...storeDoc(), toObject: () => storeDoc() };
    modelMock.create.mockResolvedValue(created);

    const store = await service.create('Loja Centro');
    expect(store.name).toBe('Loja Centro');
    expect(modelMock.create).toHaveBeenCalledWith({ name: 'Loja Centro', accounts: {} });
  });
});

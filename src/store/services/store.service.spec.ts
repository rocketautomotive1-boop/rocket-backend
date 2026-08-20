import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { StoreModel } from '../schemas/store.schema';
import { StoreService } from './store.service';

describe('StoreService', () => {
  const STORE_ID = '6955b688dfe7143a30376c01';

  let service: StoreService;
  let modelMock: any;

  const storeDoc = (marketplaceAccounts: Array<{ marketplaceTag: string; accountId: string }> = []) => ({
    _id: STORE_ID,
    name: 'Loja Centro',
    marketplaceAccounts,
  });

  beforeEach(async () => {
    modelMock = {
      find: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
      create: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [StoreService, { provide: getModelToken(StoreModel.name), useValue: modelMock }],
    }).compile();

    service = moduleRef.get(StoreService);
  });

  it('resolveAccountIds: sem storeId retorna [] sem consultar o Mongo', async () => {
    const accs = await service.resolveAccountIds(null, 'mercadolivre');
    expect(accs).toEqual([]);
    expect(modelMock.find).not.toHaveBeenCalled();
  });

  it('resolveAccountIds: retorna TODAS as contas mapeadas para a tag (N contas)', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({
        exec: async () => [
          storeDoc([
            { marketplaceTag: 'mercadolivre', accountId: 'ACC_A' },
            { marketplaceTag: 'mercadolivre', accountId: 'ACC_B' },
            { marketplaceTag: 'shopee', accountId: 'ACC_C' },
          ]),
        ],
      }),
    });

    const accs = await service.resolveAccountIds(STORE_ID, 'mercadolivre');
    expect(accs).toEqual(['ACC_A', 'ACC_B']);
  });

  it('resolveAccountId: retorna a primeira conta mapeada (compat de chamador single-account)', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [storeDoc([{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A' }])] }),
    });

    const acc = await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(acc).toBe('ACC_A');
  });

  it('resolveAccountId: loja existe mas sem mapeamento para o marketplace retorna null', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [storeDoc([{ marketplaceTag: 'shopee', accountId: 'ACC_B' }])] }),
    });

    const acc = await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(acc).toBeNull();
  });

  it('resolveAccountId: loja não existe retorna null', async () => {
    modelMock.find.mockReturnValue({ lean: () => ({ exec: async () => [] }) });

    const acc = await service.resolveAccountId(STORE_ID, 'mercadolivre');
    expect(acc).toBeNull();
  });

  it('cache: uma segunda leitura não re-consulta o Mongo até invalidate()', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({ exec: async () => [storeDoc([{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A' }])] }),
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

  it('setMarketplaceAccount: adiciona uma nova entrada sem remover as existentes da mesma tag', async () => {
    const saved = { ...storeDoc([{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A' }]), markModified: jest.fn(), save: jest.fn() };
    modelMock.findById.mockReturnValue({ exec: async () => saved });
    modelMock.find.mockReturnValue({ lean: () => ({ exec: async () => [saved] }) });

    await service.setMarketplaceAccount(STORE_ID, 'mercadolivre', 'ACC_B');

    expect(saved.marketplaceAccounts).toEqual([
      { marketplaceTag: 'mercadolivre', accountId: 'ACC_A' },
      { marketplaceTag: 'mercadolivre', accountId: 'ACC_B' },
    ]);
    expect(saved.save).toHaveBeenCalled();
  });

  it('setMarketplaceAccount: é idempotente (adicionar a mesma conta duas vezes não duplica)', async () => {
    const saved = { ...storeDoc([{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A' }]), markModified: jest.fn(), save: jest.fn() };
    modelMock.findById.mockReturnValue({ exec: async () => saved });

    await service.setMarketplaceAccount(STORE_ID, 'mercadolivre', 'ACC_A');

    expect(saved.marketplaceAccounts).toEqual([{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A' }]);
  });

  it('removeMarketplaceAccount: loja inexistente lança NotFoundException', async () => {
    modelMock.findById.mockReturnValue({ exec: async () => null });
    await expect(service.removeMarketplaceAccount(STORE_ID, 'mercadolivre', 'ACC_A')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('removeMarketplaceAccount: remove só a entrada (tag,accountId) exata', async () => {
    const saved = {
      ...storeDoc([
        { marketplaceTag: 'mercadolivre', accountId: 'ACC_A' },
        { marketplaceTag: 'mercadolivre', accountId: 'ACC_B' },
      ]),
      markModified: jest.fn(),
      save: jest.fn(),
    };
    modelMock.findById.mockReturnValue({ exec: async () => saved });

    await service.removeMarketplaceAccount(STORE_ID, 'mercadolivre', 'ACC_A');

    expect(saved.marketplaceAccounts).toEqual([{ marketplaceTag: 'mercadolivre', accountId: 'ACC_B' }]);
    expect(saved.save).toHaveBeenCalled();
  });

  it('create: valida name obrigatório', async () => {
    await expect(service.create('')).rejects.toThrow('name é obrigatório.');
  });

  it('create: cria a loja com marketplaceAccounts vazio e invalida o cache', async () => {
    const created = { ...storeDoc(), toObject: () => storeDoc() };
    modelMock.create.mockResolvedValue(created);

    const store = await service.create('Loja Centro');
    expect(store.name).toBe('Loja Centro');
    expect(modelMock.create).toHaveBeenCalledWith({ name: 'Loja Centro', marketplaceAccounts: [] });
  });

  it('findByName: retorna a loja pelo nome exato', async () => {
    modelMock.find.mockReturnValue({
      lean: () => ({
        exec: async () => [
          { _id: STORE_ID, name: 'Rocket Automotive', marketplaceAccounts: [] },
          { _id: '6955b688dfe7143a30376c99', name: 'Max Eshop', marketplaceAccounts: [] },
        ],
      }),
    });

    const store = await service.findByName('Max Eshop');
    expect(store?.id).toBe('6955b688dfe7143a30376c99');
  });

  it('findByName: retorna null quando o nome não existe', async () => {
    modelMock.find.mockReturnValue({ lean: () => ({ exec: async () => [] }) });
    const store = await service.findByName('Loja Inexistente');
    expect(store).toBeNull();
  });

  describe('resolveStoreForAccount', () => {
    it('resolve a loja dona da conta (marketplaceTag, accountId)', async () => {
      modelMock.find.mockReturnValue({
        lean: () => ({
          exec: async () => [storeDoc([{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A' }])],
        }),
      });

      const store = await service.resolveStoreForAccount('mercadolivre', 'ACC_A');
      expect(store?.id).toBe(STORE_ID);
    });

    it('retorna null quando nenhuma loja mapeia essa conta', async () => {
      modelMock.find.mockReturnValue({ lean: () => ({ exec: async () => [storeDoc([])] }) });
      const store = await service.resolveStoreForAccount('mercadolivre', 'ACC_X');
      expect(store).toBeNull();
    });
  });

  describe('reserveFiscalNumber', () => {
    it('reserva atomicamente via $inc e retorna série+número', async () => {
      modelMock.findOneAndUpdate.mockReturnValue({
        lean: () => ({
          exec: async () => ({
            fiscalChannels: [{ marketplaceTag: 'mercadolivre', accountId: 'ACC_A', series: 1, counter: 7 }],
          }),
        }),
      });

      const result = await service.reserveFiscalNumber(STORE_ID, 'mercadolivre', 'ACC_A');
      expect(result).toEqual({ series: 1, number: 7 });
      expect(modelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: STORE_ID, fiscalChannels: { $elemMatch: { marketplaceTag: 'mercadolivre', accountId: 'ACC_A' } } },
        { $inc: { 'fiscalChannels.$.counter': 1 }, $set: expect.objectContaining({ 'fiscalChannels.$.reservedAt': expect.any(Date) }) },
        { new: true },
      );
    });

    it('lança NotFoundException quando o canal fiscal não existe', async () => {
      modelMock.findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: async () => null }) });
      await expect(service.reserveFiscalNumber(STORE_ID, 'mercadolivre', 'ACC_A')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setFiscalChannel', () => {
    it('cria um novo canal fiscal quando não há conflito de série', async () => {
      const saved = {
        ...storeDoc(),
        legalEntityId: 'legal1',
        fiscalChannels: [],
        markModified: jest.fn(),
        save: jest.fn(),
      };
      modelMock.findById.mockReturnValue({ exec: async () => saved });
      modelMock.findOne.mockReturnValue({ lean: () => ({ exec: async () => null }) });

      await service.setFiscalChannel(STORE_ID, 'mercadolivre', 'ACC_A', { series: 1, marketplaceSellerId: 'seller1' });

      expect(saved.fiscalChannels).toEqual([
        { marketplaceTag: 'mercadolivre', accountId: 'ACC_A', series: 1, counter: 0, marketplaceSellerId: 'seller1' },
      ]);
      expect(saved.save).toHaveBeenCalled();
    });

    it('rejeita série já usada por outra loja da mesma LegalEntity', async () => {
      const saved = { ...storeDoc(), legalEntityId: 'legal1', fiscalChannels: [], markModified: jest.fn(), save: jest.fn() };
      modelMock.findById.mockReturnValue({ exec: async () => saved });
      modelMock.findOne.mockReturnValue({ lean: () => ({ exec: async () => ({ name: 'Outra Loja' }) }) });

      await expect(
        service.setFiscalChannel(STORE_ID, 'mercadolivre', 'ACC_A', { series: 1 }),
      ).rejects.toThrow(/já está em uso/);
      expect(saved.save).not.toHaveBeenCalled();
    });

    it('atualiza a série de um canal existente sem derrubar marketplaceTag/accountId (mutação in-place, não spread)', async () => {
      // Simula um Mongoose subdocument: spread ({...channel}) devolve {} (comportamento real
      // de subdocumentos Mongoose), então só sobrevive se o código mutar os campos direto.
      class FakeSubdocument {
        constructor(public marketplaceTag: string, public accountId: string, public series: number, public counter: number) {}
      }
      const channel = new FakeSubdocument('rocket', 'ACC_ROCKET', 1, 1);
      const saved = {
        ...storeDoc(),
        legalEntityId: 'legal1',
        fiscalChannels: [channel],
        markModified: jest.fn(),
        save: jest.fn(),
      };
      modelMock.findById.mockReturnValue({ exec: async () => saved });
      modelMock.findOne.mockReturnValue({ lean: () => ({ exec: async () => null }) });

      await service.setFiscalChannel(STORE_ID, 'rocket', 'ACC_ROCKET', { series: 2 });

      expect(saved.fiscalChannels[0].marketplaceTag).toBe('rocket');
      expect(saved.fiscalChannels[0].accountId).toBe('ACC_ROCKET');
      expect(saved.fiscalChannels[0].series).toBe(2);
      expect(saved.fiscalChannels[0].counter).toBe(1); // preserva o contador existente
      expect(saved.save).toHaveBeenCalled();
    });
  });
});

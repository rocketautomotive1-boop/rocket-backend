import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { StoreListingModel } from './schemas/store-listing.schema';
import { StoreListingService } from './store-listing.service';
import { StockMovementType } from '../stock/domain/movement-type';

describe('StoreListingService', () => {
  const PRODUCT_ID = '6955b688dfe7143a30376c01';
  const STORE_ID = '6955b688dfe7143a30376c02';

  let service: StoreListingService;
  let modelMock: any;
  let warehouseModelMock: any;

  beforeEach(async () => {
    modelMock = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };
    warehouseModelMock = {
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StoreListingService,
        { provide: getModelToken(StoreListingModel.name), useValue: modelMock },
        { provide: getModelToken('MarketplaceListingModel'), useValue: {} },
        { provide: getModelToken('StoreListingStockLotModel'), useValue: {} },
        { provide: getModelToken('StoreListingStockBalanceModel'), useValue: {} },
        { provide: getModelToken('StoreListingStockMovementModel'), useValue: {} },
        { provide: getModelToken('StoreListingWarehouseModel'), useValue: warehouseModelMock },
        { provide: getModelToken('StoreListingDamagedUnitModel'), useValue: {} },
        { provide: getModelToken('StoreListingDamagedAllocationModel'), useValue: {} },
        { provide: getModelToken('AllocationModel'), useValue: {} },
        { provide: getModelToken('ProductModel'), useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(StoreListingService);
  });

  it('create: cria um StoreListing novo quando não existe (productId, storeId)', async () => {
    modelMock.findOne.mockReturnValue({ exec: async () => null });
    const created = {
      _id: 'SL1',
      productId: PRODUCT_ID,
      storeId: STORE_ID,
      toObject: () => ({ productId: PRODUCT_ID, storeId: STORE_ID }),
    };
    modelMock.create.mockResolvedValue(created);

    const result = await service.create(PRODUCT_ID, STORE_ID);

    expect(result.id).toBe('SL1');
    expect(modelMock.create).toHaveBeenCalledWith({ productId: PRODUCT_ID, storeId: STORE_ID });
  });

  it('create: rejeita quando já existe StoreListing para (productId, storeId)', async () => {
    modelMock.findOne.mockReturnValue({ exec: async () => ({ _id: 'SL1' }) });

    await expect(service.create(PRODUCT_ID, STORE_ID)).rejects.toThrow(BadRequestException);
    expect(modelMock.create).not.toHaveBeenCalled();
  });

  it('findByProductAndStore: retorna null quando não existe', async () => {
    modelMock.findOne.mockReturnValue({ exec: async () => null });
    const result = await service.findByProductAndStore(PRODUCT_ID, STORE_ID);
    expect(result).toBeNull();
  });

  it('findByProductAndStore: retorna o StoreListing com id normalizado', async () => {
    modelMock.findOne.mockReturnValue({
      exec: async () => ({ _id: 'SL1', productId: PRODUCT_ID, storeId: STORE_ID }),
    });
    const result = await service.findByProductAndStore(PRODUCT_ID, STORE_ID);
    expect(result).toEqual({ id: 'SL1', _id: 'SL1', productId: PRODUCT_ID, storeId: STORE_ID });
  });

  it('findAnyByProduct: retorna null quando não existe StoreListing pro produto', async () => {
    modelMock.findOne.mockReturnValue({ sort: () => ({ exec: async () => null }) });
    const result = await service.findAnyByProduct(PRODUCT_ID);
    expect(result).toBeNull();
    expect(modelMock.findOne).toHaveBeenCalledWith({ productId: PRODUCT_ID });
  });

  it('findAnyByProduct: retorna o StoreListing com id normalizado, independente da loja', async () => {
    modelMock.findOne.mockReturnValue({
      sort: () => ({ exec: async () => ({ _id: 'SL1', productId: PRODUCT_ID, storeId: STORE_ID }) }),
    });
    const result = await service.findAnyByProduct(PRODUCT_ID);
    expect(result).toEqual({ id: 'SL1', _id: 'SL1', productId: PRODUCT_ID, storeId: STORE_ID });
  });

  it('findById: retorna null quando não existe', async () => {
    modelMock.findById.mockReturnValue({ exec: async () => null });
    const result = await service.findById('SL1');
    expect(result).toBeNull();
  });

  describe('warehouses', () => {
    it('createWarehouse: cria um depósito novo para a loja', async () => {
      const created = {
        _id: 'WH1',
        storeId: STORE_ID,
        name: 'Depósito Central',
        toObject: () => ({ storeId: STORE_ID, name: 'Depósito Central' }),
      };
      warehouseModelMock.create.mockResolvedValue(created);

      const result = await service.createWarehouse(STORE_ID, 'Depósito Central');

      expect(result.id).toBe('WH1');
      expect(warehouseModelMock.create).toHaveBeenCalledWith({
        storeId: STORE_ID,
        name: 'Depósito Central',
        address: undefined,
      });
    });

    it('createWarehouse: rejeita nome duplicado na mesma loja (erro 11000)', async () => {
      warehouseModelMock.create.mockRejectedValue({ code: 11000 });

      await expect(service.createWarehouse(STORE_ID, 'Depósito Central')).rejects.toThrow(BadRequestException);
    });

    it('listWarehouses: retorna os depósitos da loja com id normalizado', async () => {
      warehouseModelMock.find.mockReturnValue({
        exec: async () => [
          {
            _id: 'WH1',
            storeId: STORE_ID,
            name: 'Depósito Central',
            toObject: () => ({ storeId: STORE_ID, name: 'Depósito Central' }),
          },
        ],
      });

      const result = await service.listWarehouses(STORE_ID);

      expect(result).toEqual([{ id: 'WH1', storeId: STORE_ID, name: 'Depósito Central' }]);
      expect(warehouseModelMock.find).toHaveBeenCalledWith({ storeId: STORE_ID });
    });

    it('findWarehouseById: retorna null quando não existe', async () => {
      warehouseModelMock.findById.mockReturnValue({ exec: async () => null });
      const result = await service.findWarehouseById('68c5e6a0aabbccddeeff0011');
      expect(result).toBeNull();
    });
  });

  describe('createOrGetStoreListing', () => {
    it('reusa um StoreListing existente para o mesmo (productId, storeId)', async () => {
      modelMock.findOne.mockReturnValue({
        exec: async () => ({ _id: 'SL1', productId: PRODUCT_ID, storeId: STORE_ID }),
      });

      const result = await service.createOrGetStoreListing(PRODUCT_ID, STORE_ID);

      expect(result.id).toBe('SL1');
      expect(modelMock.create).not.toHaveBeenCalled();
    });

    it('cria um novo StoreListing quando não existe (productId, storeId)', async () => {
      modelMock.findOne.mockReturnValue({ exec: async () => null });
      const created = {
        _id: 'SL2',
        productId: PRODUCT_ID,
        storeId: STORE_ID,
        toObject: () => ({ productId: PRODUCT_ID, storeId: STORE_ID }),
      };
      modelMock.create.mockResolvedValue(created);

      const result = await service.createOrGetStoreListing(PRODUCT_ID, STORE_ID);

      expect(result.id).toBe('SL2');
      expect(modelMock.create).toHaveBeenCalledWith({ productId: PRODUCT_ID, storeId: STORE_ID });
    });

    it('corrida de criação: quando create() colide (11000) porque outro caller já inseriu, re-lê e retorna o existente em vez de lançar', async () => {
      const winnerDoc = { _id: 'SL_WINNER', productId: PRODUCT_ID, storeId: STORE_ID };
      // findOne é chamado 3x nesse caminho: (1) createOrGetStoreListing checa existência —
      // miss; (2) create() faz seu próprio pre-check interno — também miss (outro caller
      // ainda não commitou); (3) createOrGetStoreListing re-lê após o catch do 11000 —
      // acha o doc que o vencedor da corrida acabou de inserir.
      modelMock.findOne
        .mockReturnValueOnce({ exec: async () => null })
        .mockReturnValueOnce({ exec: async () => null })
        .mockReturnValueOnce({ exec: async () => winnerDoc });
      modelMock.create.mockRejectedValueOnce({ code: 11000 });

      const result = await service.createOrGetStoreListing(PRODUCT_ID, STORE_ID);

      expect(result.id).toBe('SL_WINNER');
    });

    it('duas chamadas concorrentes de createOrGetStoreListing pra um par novo resolvem com o MESMO id, sem lançar', async () => {
      // Ambas as chamadas fazem miss no primeiro findOne (corrida real: nenhuma viu a outra ainda).
      modelMock.findOne.mockReturnValue({ exec: async () => null });

      const winnerDoc = { _id: 'SL_RACE', productId: PRODUCT_ID, storeId: STORE_ID };
      let created = false;
      modelMock.create.mockImplementation(async () => {
        if (created) {
          const err: any = new Error('duplicate key');
          err.code = 11000;
          throw err;
        }
        created = true;
        return { ...winnerDoc, toObject: () => winnerDoc };
      });

      // Depois que o vencedor cria, o findOne interno (re-leitura do perdedor) deve achar winnerDoc.
      // Como o mock de findOne é genérico (mockReturnValue), qualquer chamada — inclusive a
      // re-leitura pós-catch — recebe null enquanto `created` for false, e winnerDoc depois. Para
      // simular isso de forma determinística sem depender de ordem, ajustamos o mock para refletir
      // o estado real: uma vez criado, findOne passa a achar o doc.
      modelMock.findOne.mockImplementation(() => ({
        exec: async () => (created ? winnerDoc : null),
      }));

      const [r1, r2] = await Promise.all([
        service.createOrGetStoreListing(PRODUCT_ID, STORE_ID),
        service.createOrGetStoreListing(PRODUCT_ID, STORE_ID),
      ]);

      expect(r1.id).toBe('SL_RACE');
      expect(r2.id).toBe('SL_RACE');
    });
  });

  describe('marketplace listings', () => {
    const STORE_LISTING_ID = '6955b688dfe7143a30376c03';

    let listingModelMock: any;

    beforeEach(async () => {
      listingModelMock = {
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        findByIdAndUpdate: jest.fn(),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          StoreListingService,
          { provide: getModelToken(StoreListingModel.name), useValue: modelMock },
          { provide: getModelToken('MarketplaceListingModel'), useValue: listingModelMock },
          { provide: getModelToken('StoreListingStockLotModel'), useValue: {} },
          { provide: getModelToken('StoreListingStockBalanceModel'), useValue: {} },
          { provide: getModelToken('StoreListingStockMovementModel'), useValue: {} },
          { provide: getModelToken('StoreListingWarehouseModel'), useValue: {} },
          { provide: getModelToken('StoreListingDamagedUnitModel'), useValue: {} },
          { provide: getModelToken('StoreListingDamagedAllocationModel'), useValue: {} },
          { provide: getModelToken('AllocationModel'), useValue: {} },
        { provide: getModelToken('ProductModel'), useValue: {} },
        ],
      }).compile();

      service = moduleRef.get(StoreListingService);
    });

    it('createMarketplaceListing: cria com status pending_creation', async () => {
      listingModelMock.findOne.mockReturnValue({ exec: async () => null });
      const created = {
        _id: 'ML1',
        storeListingId: STORE_LISTING_ID,
        marketplaceTag: 'mercadolivre',
        accountId: 'ACC_A',
        externalId: null,
        status: 'pending_creation',
        toObject: () => ({
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'mercadolivre',
          accountId: 'ACC_A',
          externalId: null,
          status: 'pending_creation',
        }),
      };
      listingModelMock.create.mockResolvedValue(created);

      const result = await service.createMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A');

      expect(result.id).toBe('ML1');
      expect(result.status).toBe('pending_creation');
      expect(listingModelMock.create).toHaveBeenCalledWith({
        storeListingId: STORE_LISTING_ID,
        marketplaceTag: 'mercadolivre',
        accountId: 'ACC_A',
        externalId: null,
        status: 'pending_creation',
      });
    });

    it('createMarketplaceListing: permite N listings com o mesmo storeListingId+marketplaceTag quando externalId difere', async () => {
      listingModelMock.findOne.mockReturnValueOnce({ exec: async () => null }); // primeira chamada: sem MLB111 existente
      const first = {
        _id: 'ML1',
        storeListingId: STORE_LISTING_ID,
        marketplaceTag: 'mercadolivre',
        accountId: 'ACC_A',
        externalId: 'MLB111',
        status: 'active',
        toObject: () => ({
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'mercadolivre',
          accountId: 'ACC_A',
          externalId: 'MLB111',
          status: 'active',
        }),
      };
      listingModelMock.create.mockResolvedValueOnce(first);

      const result1 = await service.createMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A', {
        externalId: 'MLB111',
        status: 'active' as any,
      });
      expect(result1.id).toBe('ML1');

      listingModelMock.findOne.mockReturnValueOnce({ exec: async () => null }); // segunda chamada: sem MLB222 existente
      const second = {
        _id: 'ML2',
        storeListingId: STORE_LISTING_ID,
        marketplaceTag: 'mercadolivre',
        accountId: 'ACC_A',
        externalId: 'MLB222',
        status: 'active',
        toObject: () => ({
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'mercadolivre',
          accountId: 'ACC_A',
          externalId: 'MLB222',
          status: 'active',
        }),
      };
      listingModelMock.create.mockResolvedValueOnce(second);

      const result2 = await service.createMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A', {
        externalId: 'MLB222',
        status: 'active' as any,
      });
      expect(result2.id).toBe('ML2');
    });

    it('createMarketplaceListing: rejeita quando o MESMO externalId já existe para (storeListingId, marketplaceTag)', async () => {
      listingModelMock.findOne.mockReturnValue({ exec: async () => ({ _id: 'ML1', externalId: 'MLB111' }) });

      await expect(
        service.createMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A', {
          externalId: 'MLB111',
          status: 'active' as any,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(listingModelMock.create).not.toHaveBeenCalled();
    });

    it('createMarketplaceListing: não faz pre-check quando externalId não é informado (pending_creation)', async () => {
      listingModelMock.create.mockResolvedValueOnce({
        _id: 'ML3',
        storeListingId: STORE_LISTING_ID,
        marketplaceTag: 'mercadolivre',
        accountId: 'ACC_A',
        externalId: null,
        status: 'pending_creation',
        toObject: () => ({
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'mercadolivre',
          accountId: 'ACC_A',
          externalId: null,
          status: 'pending_creation',
        }),
      });

      const result = await service.createMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A');

      // já coberto por 'cria com status pending_creation' quanto ao resultado; aqui garantimos que
      // nenhum findOne é necessário para permitir a criação sem externalId.
      expect(listingModelMock.findOne).not.toHaveBeenCalled();
      expect(result.id).toBe('ML3');
    });

    it('getMarketplaceListings: retorna todas as publicações do StoreListing', async () => {
      listingModelMock.find.mockReturnValue({
        exec: async () => [
          { _id: 'ML1', storeListingId: STORE_LISTING_ID, marketplaceTag: 'mercadolivre', accountId: 'ACC_A', externalId: 'MLB1', status: 'active' },
          { _id: 'ML2', storeListingId: STORE_LISTING_ID, marketplaceTag: 'shopee', accountId: 'ACC_C', externalId: null, status: 'pending_creation' },
        ],
      });

      const result = await service.getMarketplaceListings(STORE_LISTING_ID);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ML1');
      expect(result[1].marketplaceTag).toBe('shopee');
    });

    describe('upsertMarketplaceListing', () => {
      it('cria um novo MarketplaceListing quando nenhum existe', async () => {
        listingModelMock.findOne.mockReturnValue({ exec: async () => null });
        const created = {
          _id: 'ML1',
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'mercadolivre',
          accountId: 'ACC_A',
          externalId: 'MLB111',
          status: 'active',
          toObject: () => ({
            storeListingId: STORE_LISTING_ID,
            marketplaceTag: 'mercadolivre',
            accountId: 'ACC_A',
            externalId: 'MLB111',
            status: 'active',
          }),
        };
        listingModelMock.create.mockResolvedValueOnce(created);

        const result = await service.upsertMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A', {
          externalId: 'MLB111',
          status: 'active' as any,
        });

        expect(result.id).toBe('ML1');
        expect(listingModelMock.create).toHaveBeenCalled();
      });

      it('atualiza o MarketplaceListing existente in place quando já existe um match', async () => {
        const existing = {
          _id: 'ML1',
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'mercadolivre',
          accountId: 'ACC_A',
          externalId: 'MLB111',
          status: 'pending_creation',
        };
        listingModelMock.findOne.mockReturnValue({ exec: async () => existing });
        listingModelMock.findByIdAndUpdate.mockReturnValue({
          exec: async () => ({
            ...existing,
            status: 'active',
            toObject: () => ({ ...existing, status: 'active' }),
          }),
        });

        const result = await service.upsertMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A', {
          externalId: 'MLB111',
          status: 'active' as any,
        });

        expect(result.status).toBe('active');
        expect(listingModelMock.create).not.toHaveBeenCalled();
        expect(listingModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
          'ML1',
          expect.objectContaining({ $set: expect.objectContaining({ status: 'active' }) }),
          expect.any(Object),
        );
      });

      it('atualiza in place (não duplica) quando chamado 2x seguidas com externalId null (pending/OLX assíncrono)', async () => {
        const pendingRow = {
          _id: 'MLP1',
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'olx',
          accountId: 'ACC_A',
          externalId: null,
          status: 'pending_creation',
        };

        // Primeira chamada: nenhum existente (nem por externalId:null, nem pending com real externalId).
        listingModelMock.findOne.mockReturnValueOnce({ exec: async () => null });
        listingModelMock.create.mockResolvedValueOnce({
          ...pendingRow,
          toObject: () => pendingRow,
        });

        const result1 = await service.upsertMarketplaceListing(STORE_LISTING_ID, 'olx', 'ACC_A', {
          externalId: null,
          status: 'pending_creation' as any,
        });
        expect(result1.id).toBe('MLP1');
        expect(listingModelMock.create).toHaveBeenCalledTimes(1);

        // Segunda chamada (retry do SyncQueue): agora findOne({..., externalId: null}) acha a linha
        // criada acima — deve atualizar in place, NÃO criar uma segunda linha.
        listingModelMock.findOne.mockReturnValueOnce({ exec: async () => pendingRow });
        listingModelMock.findByIdAndUpdate.mockReturnValueOnce({
          exec: async () => ({
            ...pendingRow,
            status: 'pending_creation',
            toObject: () => pendingRow,
          }),
        });

        const result2 = await service.upsertMarketplaceListing(STORE_LISTING_ID, 'olx', 'ACC_A', {
          externalId: null,
          status: 'pending_creation' as any,
        });

        expect(result2.id).toBe('MLP1');
        // create() ainda só foi chamado uma vez no total (a segunda chamada atualizou, não criou).
        expect(listingModelMock.create).toHaveBeenCalledTimes(1);
        expect(listingModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
          'MLP1',
          expect.objectContaining({ $set: expect.objectContaining({ status: 'pending_creation' }) }),
          expect.any(Object),
        );
      });

      it('atualiza in place quando chamado novamente com o MESMO externalId real (comportamento pré-existente preservado)', async () => {
        const existing = {
          _id: 'ML9',
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'mercadolivre',
          accountId: 'ACC_A',
          externalId: 'MLB999',
          status: 'active',
        };
        listingModelMock.findOne.mockReturnValue({ exec: async () => existing });
        listingModelMock.findByIdAndUpdate.mockReturnValue({
          exec: async () => ({ ...existing, toObject: () => existing }),
        });

        const result = await service.upsertMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A', {
          externalId: 'MLB999',
          status: 'active' as any,
        });

        expect(result.id).toBe('ML9');
        expect(listingModelMock.create).not.toHaveBeenCalled();
      });

      it('transição pending→publicado: herda a linha pending (externalId:null) em vez de criar uma nova quando chega o externalId real', async () => {
        const pendingRow = {
          _id: 'MLP2',
          storeListingId: STORE_LISTING_ID,
          marketplaceTag: 'olx',
          accountId: 'ACC_A',
          externalId: null,
          status: 'pending_creation',
        };

        // Lookup por externalId real: nada encontrado.
        listingModelMock.findOne.mockReturnValueOnce({ exec: async () => null });
        // Lookup de fallback por externalId:null: encontra a linha pending.
        listingModelMock.findOne.mockReturnValueOnce({ exec: async () => pendingRow });
        listingModelMock.findByIdAndUpdate.mockReturnValueOnce({
          exec: async () => ({
            ...pendingRow,
            externalId: 'MLB777',
            status: 'active',
            toObject: () => ({ ...pendingRow, externalId: 'MLB777', status: 'active' }),
          }),
        });

        const result = await service.upsertMarketplaceListing(STORE_LISTING_ID, 'olx', 'ACC_A', {
          externalId: 'MLB777',
          status: 'active' as any,
        });

        expect(result.id).toBe('MLP2');
        expect(result.externalId).toBe('MLB777');
        expect(listingModelMock.create).not.toHaveBeenCalled();
        expect(listingModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
          'MLP2',
          expect.objectContaining({
            $set: expect.objectContaining({ status: 'active', externalId: 'MLB777' }),
          }),
          expect.any(Object),
        );
      });
    });
  });

  describe('recordStockMovement', () => {
    const STORE_LISTING_ID = '6955b688dfe7143a30376c03';
    const STORE_LISTING_OID = new Types.ObjectId(STORE_LISTING_ID);
    const LOT1_OID = new Types.ObjectId('6955b688dfe7143a30376c11');

    let stockLotModelMock: any;
    let stockBalanceModelMock: any;
    let stockMovementModelMock: any;

    beforeEach(async () => {
      stockLotModelMock = {
        findOne: jest.fn(),
        findById: jest.fn(),
        findOneAndUpdate: jest.fn(),
        create: jest.fn(),
      };
      stockBalanceModelMock = {
        updateOne: jest.fn(),
      };
      stockMovementModelMock = {
        create: jest.fn(),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          StoreListingService,
          { provide: getModelToken(StoreListingModel.name), useValue: modelMock },
          { provide: getModelToken('MarketplaceListingModel'), useValue: {} },
          { provide: getModelToken('StoreListingStockLotModel'), useValue: stockLotModelMock },
          { provide: getModelToken('StoreListingStockBalanceModel'), useValue: stockBalanceModelMock },
          { provide: getModelToken('StoreListingStockMovementModel'), useValue: stockMovementModelMock },
          { provide: getModelToken('StoreListingWarehouseModel'), useValue: {} },
          { provide: getModelToken('StoreListingDamagedUnitModel'), useValue: {} },
          { provide: getModelToken('StoreListingDamagedAllocationModel'), useValue: {} },
          { provide: getModelToken('AllocationModel'), useValue: {} },
        { provide: getModelToken('ProductModel'), useValue: {} },
        ],
      }).compile();

      service = moduleRef.get(StoreListingService);
    });

    it('cria um novo lote quando nenhum existe para (storeListingId, condition) via upsert atômico e faz upsert atômico do saldo', async () => {
      stockLotModelMock.findOneAndUpdate.mockReturnValue({ exec: async () => ({ _id: LOT1_OID }) });
      stockBalanceModelMock.updateOne.mockResolvedValue({ acknowledged: true });
      stockMovementModelMock.create.mockResolvedValue({ _id: 'MOV1' });

      const result = await service.recordStockMovement({
        storeListingId: STORE_LISTING_ID,
        type: StockMovementType.INBOUND,
        quantity: 5,
      });

      expect(result.lotId).toBe(String(LOT1_OID));
      expect(result.movementId).toBe('MOV1');
      expect(stockLotModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { storeListingId: STORE_LISTING_OID, condition: 'new' },
        expect.objectContaining({ $setOnInsert: expect.objectContaining({ storeListingId: STORE_LISTING_OID, condition: 'new' }) }),
        expect.objectContaining({ upsert: true, new: true }),
      );
      expect(stockLotModelMock.create).not.toHaveBeenCalled();
      expect(stockBalanceModelMock.updateOne).toHaveBeenCalledWith(
        { storeListingId: STORE_LISTING_OID, lotId: LOT1_OID, boxId: null },
        { $inc: { onHand: 5, reserved: 0 }, $setOnInsert: { condition: 'new' } },
        { upsert: true },
      );
    });

    it('reusa um lote existente para a mesma (storeListingId, condition) sem recriar', async () => {
      stockLotModelMock.findOneAndUpdate.mockReturnValue({ exec: async () => ({ _id: LOT1_OID }) });
      stockBalanceModelMock.updateOne.mockResolvedValue({ acknowledged: true });
      stockMovementModelMock.create.mockResolvedValue({ _id: 'MOV2' });

      const result = await service.recordStockMovement({
        storeListingId: STORE_LISTING_ID,
        type: StockMovementType.OUTBOUND,
        quantity: 3,
      });

      expect(result.lotId).toBe(String(LOT1_OID));
      expect(stockLotModelMock.create).not.toHaveBeenCalled();
      expect(stockBalanceModelMock.updateOne).toHaveBeenCalledWith(
        { storeListingId: STORE_LISTING_OID, lotId: LOT1_OID, boxId: null },
        { $inc: { onHand: -3, reserved: 0 }, $setOnInsert: { condition: 'new' } },
        { upsert: true },
      );
    });

    it('duas chamadas concorrentes para (storeListingId, condition) sem lotId explícito resolvem o MESMO lote (upsert atômico evita corrida)', async () => {
      // findOneAndUpdate com upsert:true é atômico no Mongo real: a segunda chamada concorrente
      // enxerga o documento que a primeira acabou de inserir, em vez de cada uma criar o seu.
      // Aqui simulamos isso fazendo o mock sempre devolver o mesmo lote already-resolved.
      stockLotModelMock.findOneAndUpdate.mockReturnValue({ exec: async () => ({ _id: LOT1_OID }) });
      stockBalanceModelMock.updateOne.mockResolvedValue({ acknowledged: true });
      stockMovementModelMock.create.mockResolvedValue({ _id: 'MOV1' });

      const [r1, r2] = await Promise.all([
        service.recordStockMovement({ storeListingId: STORE_LISTING_ID, type: StockMovementType.INBOUND, quantity: 1 }),
        service.recordStockMovement({ storeListingId: STORE_LISTING_ID, type: StockMovementType.INBOUND, quantity: 1 }),
      ]);

      expect(r1.lotId).toBe(String(LOT1_OID));
      expect(r2.lotId).toBe(String(LOT1_OID));
      expect(stockLotModelMock.create).not.toHaveBeenCalled();
      // Ambas as chamadas devem ter usado findOneAndUpdate (nunca um find-then-create de duas etapas,
      // que é a race que produz dois lotes para a mesma (storeListingId, condition) em produção).
      expect(stockLotModelMock.findOneAndUpdate).toHaveBeenCalledTimes(2);
    });

    it('acumula onHand via $inc (não overwrite) numa segunda movimentação contra o mesmo (lotId, boxId)', async () => {
      stockLotModelMock.findOneAndUpdate.mockReturnValue({ exec: async () => ({ _id: LOT1_OID }) });
      stockBalanceModelMock.updateOne.mockResolvedValue({ acknowledged: true });
      stockMovementModelMock.create.mockResolvedValue({ _id: 'MOV1' });

      await service.recordStockMovement({
        storeListingId: STORE_LISTING_ID,
        type: StockMovementType.INBOUND,
        quantity: 5,
      });

      stockMovementModelMock.create.mockResolvedValue({ _id: 'MOV2' });
      await service.recordStockMovement({
        storeListingId: STORE_LISTING_ID,
        type: StockMovementType.INBOUND,
        quantity: 2,
      });

      expect(stockBalanceModelMock.updateOne).toHaveBeenNthCalledWith(
        1,
        { storeListingId: STORE_LISTING_OID, lotId: LOT1_OID, boxId: null },
        { $inc: { onHand: 5, reserved: 0 }, $setOnInsert: { condition: 'new' } },
        { upsert: true },
      );
      expect(stockBalanceModelMock.updateOne).toHaveBeenNthCalledWith(
        2,
        { storeListingId: STORE_LISTING_OID, lotId: LOT1_OID, boxId: null },
        { $inc: { onHand: 2, reserved: 0 }, $setOnInsert: { condition: 'new' } },
        { upsert: true },
      );
      // No manual read-modify-write: updateOne is called with the raw per-call delta,
      // never a pre-summed running total computed in application code.
      expect(stockBalanceModelMock.updateOne).toHaveBeenCalledTimes(2);
    });

    it('usa fromBoxId/toBoxId como chave boxId no saldo quando informado (transfer usa toBoxId)', async () => {
      stockLotModelMock.findOneAndUpdate.mockReturnValue({ exec: async () => ({ _id: LOT1_OID }) });
      stockBalanceModelMock.updateOne.mockResolvedValue({ acknowledged: true });
      stockMovementModelMock.create.mockResolvedValue({ _id: 'MOV3' });

      const BOX1_OID = new Types.ObjectId('6955b688dfe7143a30376c22');
      await service.recordStockMovement({
        storeListingId: STORE_LISTING_ID,
        type: StockMovementType.INBOUND,
        quantity: 1,
        toBoxId: String(BOX1_OID),
      });

      expect(stockBalanceModelMock.updateOne).toHaveBeenCalledWith(
        { storeListingId: STORE_LISTING_OID, lotId: LOT1_OID, boxId: BOX1_OID },
        { $inc: { onHand: 1, reserved: 0 }, $setOnInsert: { condition: 'new' } },
        { upsert: true },
      );
    });

    it('registra o movimento com os campos informados, sem original*Id (documento novo, não migrado)', async () => {
      stockLotModelMock.findOneAndUpdate.mockReturnValue({ exec: async () => ({ _id: LOT1_OID }) });
      stockBalanceModelMock.updateOne.mockResolvedValue({ acknowledged: true });
      stockMovementModelMock.create.mockResolvedValue({ _id: 'MOV1' });

      await service.recordStockMovement({
        storeListingId: STORE_LISTING_ID,
        type: StockMovementType.INBOUND,
        quantity: 5,
        orderId: 'ORDER1',
        unitCost: '12.50',
        reason: 'compra',
      });

      const createArg = stockMovementModelMock.create.mock.calls[0][0];
      expect(createArg).toMatchObject({
        storeListingId: STORE_LISTING_OID,
        lotId: LOT1_OID,
        type: StockMovementType.INBOUND,
        quantity: 5,
        orderId: 'ORDER1',
        unitCost: '12.50',
        reason: 'compra',
        condition: 'new',
      });
      expect(createArg.originalMovementId).toBeUndefined();
    });

    it('usa lotId explícito (findById) quando informado, sem consultar por (storeListingId, condition)', async () => {
      stockLotModelMock.findById.mockReturnValue({ exec: async () => ({ _id: 'LOT9' }) });
      stockBalanceModelMock.updateOne.mockResolvedValue({ acknowledged: true });
      stockMovementModelMock.create.mockResolvedValue({ _id: 'MOV1' });

      const result = await service.recordStockMovement({
        storeListingId: STORE_LISTING_ID,
        type: StockMovementType.INBOUND,
        quantity: 1,
        lotId: 'LOT9',
      });

      expect(result.lotId).toBe('LOT9');
      expect(stockLotModelMock.findById).toHaveBeenCalledWith('LOT9');
      expect(stockLotModelMock.findOne).not.toHaveBeenCalled();
    });
  });

  describe('markUnitsAsDamaged', () => {
    let lotModelMock: any;
    let balanceModelMock: any;
    let movementModelMock: any;
    let damagedUnitModelMock: any;

    beforeEach(async () => {
      lotModelMock = { findOneAndUpdate: jest.fn(), findById: jest.fn() };
      balanceModelMock = { updateOne: jest.fn() };
      movementModelMock = { create: jest.fn() };
      damagedUnitModelMock = { create: jest.fn() };

      const moduleRef = await Test.createTestingModule({
        providers: [
          StoreListingService,
          { provide: getModelToken(StoreListingModel.name), useValue: modelMock },
          { provide: getModelToken('MarketplaceListingModel'), useValue: {} },
          { provide: getModelToken('StoreListingStockLotModel'), useValue: lotModelMock },
          { provide: getModelToken('StoreListingStockBalanceModel'), useValue: balanceModelMock },
          { provide: getModelToken('StoreListingStockMovementModel'), useValue: movementModelMock },
          { provide: getModelToken('StoreListingWarehouseModel'), useValue: {} },
          { provide: getModelToken('StoreListingDamagedUnitModel'), useValue: damagedUnitModelMock },
          { provide: getModelToken('StoreListingDamagedAllocationModel'), useValue: {} },
          { provide: getModelToken('AllocationModel'), useValue: {} },
        { provide: getModelToken('ProductModel'), useValue: {} },
        ],
      }).compile();

      service = moduleRef.get(StoreListingService);
    });

    it('debita do lote fungível e cria N unidades avariadas', async () => {
      const LOT_OID = new Types.ObjectId('6955b688dfe7143a30376c11');
      const SL_OID = new Types.ObjectId('6955b688dfe7143a30376c03');
      modelMock.findOne.mockReturnValue({
        exec: async () => ({ _id: SL_OID, productId: PRODUCT_ID, storeId: STORE_ID }),
      });
      lotModelMock.findOneAndUpdate.mockReturnValue({ exec: async () => ({ _id: LOT_OID }) });
      balanceModelMock.updateOne.mockResolvedValue({});
      movementModelMock.create.mockResolvedValue({ _id: 'MOV1' });
      damagedUnitModelMock.create
        .mockResolvedValueOnce({ _id: 'DU1', toObject: () => ({}) })
        .mockResolvedValueOnce({ _id: 'DU2', toObject: () => ({}) });

      const result = await service.markUnitsAsDamaged({
        productId: PRODUCT_ID,
        storeId: STORE_ID,
        sourceCondition: 'new',
        quantity: 2,
        targetCondition: 'damaged',
      });

      expect(result.unitIds).toEqual(['DU1', 'DU2']);
      expect(damagedUnitModelMock.create).toHaveBeenCalledTimes(2);
      expect(damagedUnitModelMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          condition: 'damaged',
          status: 'in_stock',
        }),
      );
    });

    it('rejeita quantidade <= 0', async () => {
      await expect(
        service.markUnitsAsDamaged({
          productId: PRODUCT_ID,
          storeId: STORE_ID,
          sourceCondition: 'new',
          quantity: 0,
          targetCondition: 'damaged',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(damagedUnitModelMock.create).not.toHaveBeenCalled();
    });

    it('rejeita quando o produto não tem StoreListing na loja', async () => {
      modelMock.findOne.mockReturnValue({ exec: async () => null });

      await expect(
        service.markUnitsAsDamaged({
          productId: PRODUCT_ID,
          storeId: STORE_ID,
          sourceCondition: 'new',
          quantity: 2,
          targetCondition: 'damaged',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(damagedUnitModelMock.create).not.toHaveBeenCalled();
    });
  });

  describe('damaged unit completion', () => {
    let listingModelMock2: any;
    let warehouseModelMock2: any;
    let damagedUnitModelMock2: any;
    let damagedAllocationModelMock: any;

    beforeEach(async () => {
      listingModelMock2 = { findById: jest.fn() };
      warehouseModelMock2 = { findById: jest.fn() };
      damagedUnitModelMock2 = { findById: jest.fn(), findByIdAndUpdate: jest.fn(), find: jest.fn() };
      damagedAllocationModelMock = { findOneAndUpdate: jest.fn() };

      const moduleRef = await Test.createTestingModule({
        providers: [
          StoreListingService,
          { provide: getModelToken(StoreListingModel.name), useValue: listingModelMock2 },
          { provide: getModelToken('MarketplaceListingModel'), useValue: {} },
          { provide: getModelToken('StoreListingStockLotModel'), useValue: {} },
          { provide: getModelToken('StoreListingStockBalanceModel'), useValue: {} },
          { provide: getModelToken('StoreListingStockMovementModel'), useValue: {} },
          { provide: getModelToken('StoreListingWarehouseModel'), useValue: warehouseModelMock2 },
          { provide: getModelToken('StoreListingDamagedUnitModel'), useValue: damagedUnitModelMock2 },
          { provide: getModelToken('StoreListingDamagedAllocationModel'), useValue: damagedAllocationModelMock },
          { provide: getModelToken('AllocationModel'), useValue: {} },
        { provide: getModelToken('ProductModel'), useValue: {} },
        ],
      }).compile();

      service = moduleRef.get(StoreListingService);
    });

    it('updateDamagedUnit: atualiza fotos, descrição e preço', async () => {
      damagedUnitModelMock2.findById.mockReturnValue({
        exec: async () => ({ _id: 'DU1', storeListingId: 'SL1' }),
      });
      listingModelMock2.findById.mockReturnValue({ exec: async () => ({ _id: 'SL1', storeId: STORE_ID }) });
      damagedUnitModelMock2.findByIdAndUpdate.mockReturnValue({
        exec: async () => ({
          _id: 'DU1',
          toObject: () => ({ photos: ['url1'], damageNotes: 'Risco na lateral', price: '99.90' }),
        }),
      });

      const result = await service.updateDamagedUnit('DU1', STORE_ID, {
        photos: ['url1'],
        damageNotes: 'Risco na lateral',
        price: 99.9,
      });

      expect(result.id).toBe('DU1');
      expect(damagedUnitModelMock2.findByIdAndUpdate).toHaveBeenCalledWith(
        'DU1',
        { $set: { photos: ['url1'], damageNotes: 'Risco na lateral', price: 99.9 } },
        { new: true },
      );
    });

    it('updateDamagedUnit: rejeita quando a unidade pertence a outra loja', async () => {
      damagedUnitModelMock2.findById.mockReturnValue({
        exec: async () => ({ _id: 'DU1', storeListingId: 'SL1' }),
      });
      listingModelMock2.findById.mockReturnValue({ exec: async () => ({ _id: 'SL1', storeId: 'OTHER_STORE' }) });

      await expect(
        service.updateDamagedUnit('DU1', STORE_ID, { damageNotes: 'Tentativa de outra loja' }),
      ).rejects.toThrow(BadRequestException);
      expect(damagedUnitModelMock2.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('allocateDamagedUnit: rejeita quando o depósito é de outra loja', async () => {
      damagedUnitModelMock2.findById.mockReturnValue({
        exec: async () => ({ _id: 'DU1', storeListingId: 'SL1' }),
      });
      listingModelMock2.findById.mockReturnValue({ exec: async () => ({ _id: 'SL1', storeId: STORE_ID }) });
      warehouseModelMock2.findById.mockReturnValue({ exec: async () => ({ _id: 'WH1', storeId: 'OTHER_STORE' }) });

      await expect(service.allocateDamagedUnit('DU1', STORE_ID, 'WH1')).rejects.toThrow(BadRequestException);
    });

    it('allocateDamagedUnit: rejeita quando a unidade pertence a outra loja', async () => {
      damagedUnitModelMock2.findById.mockReturnValue({
        exec: async () => ({ _id: 'DU1', storeListingId: 'SL1' }),
      });
      listingModelMock2.findById.mockReturnValue({ exec: async () => ({ _id: 'SL1', storeId: 'OTHER_STORE' }) });

      await expect(service.allocateDamagedUnit('DU1', STORE_ID, 'WH1')).rejects.toThrow(BadRequestException);
      expect(warehouseModelMock2.findById).not.toHaveBeenCalled();
    });

    it('allocateDamagedUnit: cria a allocation quando o depósito é da mesma loja', async () => {
      damagedUnitModelMock2.findById.mockReturnValue({
        exec: async () => ({ _id: 'DU1', storeListingId: 'SL1' }),
      });
      listingModelMock2.findById.mockReturnValue({ exec: async () => ({ _id: 'SL1', storeId: STORE_ID }) });
      warehouseModelMock2.findById.mockReturnValue({ exec: async () => ({ _id: 'WH1', storeId: STORE_ID }) });
      damagedAllocationModelMock.findOneAndUpdate.mockResolvedValue({
        _id: 'ALLOC1',
        toObject: () => ({ damagedUnitId: 'DU1', warehouseId: 'WH1' }),
      });

      const result = await service.allocateDamagedUnit('DU1', STORE_ID, 'WH1', 'Prateleira 3');

      expect(result.id).toBe('ALLOC1');
      expect(damagedAllocationModelMock.findOneAndUpdate).toHaveBeenCalledWith(
        { damagedUnitId: 'DU1' },
        { $set: { warehouseId: 'WH1', position: 'Prateleira 3' } },
        { upsert: true, new: true },
      );
    });

    it('isDamagedUnitPublishable: false quando falta preço', async () => {
      damagedUnitModelMock2.findById.mockReturnValue({
        exec: async () => ({ photos: ['url1'], damageNotes: 'Risco', price: null }),
      });

      const result = await service.isDamagedUnitPublishable('DU1');

      expect(result).toBe(false);
    });

    it('isDamagedUnitPublishable: false quando falta foto', async () => {
      damagedUnitModelMock2.findById.mockReturnValue({
        exec: async () => ({ photos: [], damageNotes: 'Risco', price: { toString: () => '99.9' } }),
      });

      const result = await service.isDamagedUnitPublishable('DU1');

      expect(result).toBe(false);
    });

    it('isDamagedUnitPublishable: true quando fotos, descrição e preço presentes', async () => {
      damagedUnitModelMock2.findById.mockReturnValue({
        exec: async () => ({ photos: ['url1'], damageNotes: 'Risco', price: { toString: () => '99.9' } }),
      });

      const result = await service.isDamagedUnitPublishable('DU1');

      expect(result).toBe(true);
    });

    it('listDamagedUnits: filtra por status quando informado', async () => {
      listingModelMock2.findOne = jest.fn().mockReturnValue({
        exec: async () => ({ _id: 'SL1', productId: PRODUCT_ID, storeId: STORE_ID }),
      });
      damagedUnitModelMock2.find.mockReturnValue({
        exec: async () => [{ _id: 'DU1', toObject: () => ({ storeListingId: 'SL1', status: 'in_stock' }) }],
      });

      const result = await service.listDamagedUnits(PRODUCT_ID, STORE_ID, 'in_stock');

      expect(result).toEqual([{ id: 'DU1', storeListingId: 'SL1', status: 'in_stock' }]);
      expect(damagedUnitModelMock2.find).toHaveBeenCalledWith({ storeListingId: 'SL1', status: 'in_stock' });
    });

    it('listDamagedUnits: sem status filtra só por storeListingId', async () => {
      listingModelMock2.findOne = jest.fn().mockReturnValue({
        exec: async () => ({ _id: 'SL1', productId: PRODUCT_ID, storeId: STORE_ID }),
      });
      damagedUnitModelMock2.find.mockReturnValue({ exec: async () => [] });

      await service.listDamagedUnits(PRODUCT_ID, STORE_ID);

      expect(damagedUnitModelMock2.find).toHaveBeenCalledWith({ storeListingId: 'SL1' });
    });

    it('listDamagedUnits: sem StoreListing na loja retorna vazio', async () => {
      listingModelMock2.findOne = jest.fn().mockReturnValue({ exec: async () => null });

      const result = await service.listDamagedUnits(PRODUCT_ID, STORE_ID);

      expect(result).toEqual([]);
      expect(damagedUnitModelMock2.find).not.toHaveBeenCalled();
    });
  });
});

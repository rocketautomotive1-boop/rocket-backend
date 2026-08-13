import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { StoreListingModel } from './schemas/store-listing.schema';
import { StoreListingService } from './store-listing.service';

describe('StoreListingService', () => {
  const PRODUCT_ID = '6955b688dfe7143a30376c01';
  const STORE_ID = '6955b688dfe7143a30376c02';

  let service: StoreListingService;
  let modelMock: any;

  beforeEach(async () => {
    modelMock = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StoreListingService,
        { provide: getModelToken(StoreListingModel.name), useValue: modelMock },
        { provide: getModelToken('MarketplaceListingModel'), useValue: {} },
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

  it('findById: retorna null quando não existe', async () => {
    modelMock.findById.mockReturnValue({ exec: async () => null });
    const result = await service.findById('SL1');
    expect(result).toBeNull();
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
    });
  });
});

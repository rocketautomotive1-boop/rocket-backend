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

  describe('marketplace listings', () => {
    const STORE_LISTING_ID = '6955b688dfe7143a30376c03';

    let listingModelMock: any;

    beforeEach(async () => {
      listingModelMock = {
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
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

    it('createMarketplaceListing: rejeita duplicata (storeListingId, marketplaceTag)', async () => {
      listingModelMock.findOne.mockReturnValue({ exec: async () => ({ _id: 'ML1' }) });

      await expect(
        service.createMarketplaceListing(STORE_LISTING_ID, 'mercadolivre', 'ACC_A'),
      ).rejects.toThrow(BadRequestException);
      expect(listingModelMock.create).not.toHaveBeenCalled();
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
  });
});

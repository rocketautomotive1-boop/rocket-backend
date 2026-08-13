import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ListingModel } from './schemas/listing.schema';
import { ListingService } from './listing.service';
import { STORE_LISTING_PORT } from '../store-listing/ports/store-listing.port';
import { STORE_PORT } from '../store/ports/store.port';
import { MarketplaceConfigCacheService } from '../marketplace/services/marketplace-config-cache.service';

describe('ListingService', () => {
  let service: ListingService;
  let listingModelMock: any;
  let storeListingPortMock: any;
  let storePortMock: any;
  let configCacheMock: any;

  beforeEach(async () => {
    listingModelMock = {
      create: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    storeListingPortMock = {
      createOrGetStoreListing: jest.fn(),
      upsertMarketplaceListing: jest.fn(),
    };
    storePortMock = {
      resolveAccountId: jest.fn(),
    };
    configCacheMock = {
      getById: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListingService,
        { provide: getModelToken(ListingModel.name), useValue: listingModelMock },
        { provide: STORE_LISTING_PORT, useValue: storeListingPortMock },
        { provide: STORE_PORT, useValue: storePortMock },
        { provide: MarketplaceConfigCacheService, useValue: configCacheMock },
      ],
    }).compile();

    service = moduleRef.get(ListingService);
  });

  describe('create — dual-write', () => {
    const productId = new Types.ObjectId();
    const marketplaceId = new Types.ObjectId();
    const storeId = new Types.ObjectId();

    it('writes to the legacy model AND mirrors into StoreListing/MarketplaceListing on success', async () => {
      const created = { _id: 'L1', productId, marketplaceId, storeId, externalId: 'MLB1', status: 'active' };
      listingModelMock.create.mockResolvedValue(created);
      configCacheMock.getById.mockResolvedValue({ tag: 'mercadolivre' });
      storePortMock.resolveAccountId.mockResolvedValue('ACC1');
      storeListingPortMock.createOrGetStoreListing.mockResolvedValue({ id: 'SL1' });
      storeListingPortMock.upsertMarketplaceListing.mockResolvedValue({ id: 'ML1' });

      const result = await service.create({ productId, marketplaceId, storeId, externalId: 'MLB1', status: 'active' } as any);

      expect(result).toBe(created);
      expect(storeListingPortMock.createOrGetStoreListing).toHaveBeenCalledWith(String(productId), String(storeId));
      expect(storePortMock.resolveAccountId).toHaveBeenCalledWith(String(storeId), 'mercadolivre');
      expect(storeListingPortMock.upsertMarketplaceListing).toHaveBeenCalledWith(
        'SL1',
        'mercadolivre',
        'ACC1',
        expect.objectContaining({ externalId: 'MLB1', status: 'active' }),
      );
    });

    it('still returns the legacy result even when the dual-write throws', async () => {
      const created = { _id: 'L1', productId, marketplaceId, storeId, externalId: 'MLB1', status: 'active' };
      listingModelMock.create.mockResolvedValue(created);
      configCacheMock.getById.mockResolvedValue({ tag: 'mercadolivre' });
      storeListingPortMock.createOrGetStoreListing.mockRejectedValue(new Error('boom'));

      const result = await service.create({ productId, marketplaceId, storeId, externalId: 'MLB1', status: 'active' } as any);

      expect(result).toBe(created);
    });

    it('skips dual-write silently when the listing has no storeId yet (pre-migration edge case)', async () => {
      const created = { _id: 'L1', productId, marketplaceId, storeId: undefined, externalId: 'MLB1', status: 'active' };
      listingModelMock.create.mockResolvedValue(created);

      const result = await service.create({ productId, marketplaceId, externalId: 'MLB1', status: 'active' } as any);

      expect(result).toBe(created);
      expect(storeListingPortMock.createOrGetStoreListing).not.toHaveBeenCalled();
    });

    it('skips dual-write and logs when the store has no account configured for that marketplace', async () => {
      const created = { _id: 'L1', productId, marketplaceId, storeId, externalId: 'MLB1', status: 'active' };
      listingModelMock.create.mockResolvedValue(created);
      configCacheMock.getById.mockResolvedValue({ tag: 'mercadolivre' });
      storeListingPortMock.createOrGetStoreListing.mockResolvedValue({ id: 'SL1' });
      storePortMock.resolveAccountId.mockResolvedValue(null);

      const result = await service.create({ productId, marketplaceId, storeId, externalId: 'MLB1', status: 'active' } as any);

      expect(result).toBe(created);
      expect(storeListingPortMock.upsertMarketplaceListing).not.toHaveBeenCalled();
    });
  });
});

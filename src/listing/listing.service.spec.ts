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
      find: jest.fn(),
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

    it('regressão: rejeita create() sem storeId — storeId é identidade, não pode nascer ausente (ver docs/superpowers/specs/2026-08-12-store-as-aggregate-root-design.md)', async () => {
      await expect(
        service.create({ productId, marketplaceId, externalId: 'MLB1', status: 'active' } as any),
      ).rejects.toThrow('ListingModel requer storeId');
      expect(listingModelMock.create).not.toHaveBeenCalled();
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

  describe('createOrUpdate — guard de storeId', () => {
    it('regressão: rejeita sem storeId, sem chamar findOneAndUpdate/create', async () => {
      await expect(
        service.createOrUpdate({ marketplaceId: new Types.ObjectId(), externalId: 'MLB1' } as any),
      ).rejects.toThrow('ListingModel requer storeId');
      expect(listingModelMock.findOneAndUpdate).not.toHaveBeenCalled();
      expect(listingModelMock.create).not.toHaveBeenCalled();
    });

    it('permite quando storeId presente', async () => {
      const storeId = new Types.ObjectId();
      const marketplaceId = new Types.ObjectId();
      const upserted = { _id: 'L1', storeId, marketplaceId, externalId: 'MLB1' };
      listingModelMock.findOneAndUpdate.mockResolvedValue(upserted);

      const result = await service.createOrUpdate({ storeId, marketplaceId, externalId: 'MLB1' } as any);

      expect(result).toBe(upserted);
      expect(listingModelMock.findOneAndUpdate).toHaveBeenCalled();
    });
  });

  describe('findByProductAndStore', () => {
    it('queries by both productId and storeId, casting strings to ObjectId', async () => {
      const productId = new Types.ObjectId().toHexString();
      const storeId = new Types.ObjectId().toHexString();
      const execMock = jest.fn().mockResolvedValue([{ _id: 'L1' }]);
      listingModelMock.find.mockReturnValue({ exec: execMock });

      const result = await service.findByProductAndStore(productId, storeId);

      expect(listingModelMock.find).toHaveBeenCalledWith({
        productId: new Types.ObjectId(productId),
        storeId: new Types.ObjectId(storeId),
      });
      expect(result).toEqual([{ _id: 'L1' }]);
    });
  });
});

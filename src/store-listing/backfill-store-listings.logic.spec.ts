import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { backfillStoreListings, ListingRow, mapLegacyStatus, nextSkip } from '../../scripts/backfill-store-listings';

describe('mapLegacyStatus', () => {
  it('preserves operational statuses that exist in the new model', () => {
    expect(mapLegacyStatus('active')).toBe('active');
    expect(mapLegacyStatus('paused')).toBe('paused');
    expect(mapLegacyStatus('error')).toBe('error');
    expect(mapLegacyStatus('pending_creation')).toBe('pending_creation');
  });

  it('maps removal-related legacy statuses to error (no 1:1 equivalent yet)', () => {
    expect(mapLegacyStatus('pending_removal')).toBe('error');
    expect(mapLegacyStatus('removal_failed')).toBe('error');
    expect(mapLegacyStatus('removed')).toBe('error');
  });

  it('maps an unknown/unexpected status to error rather than throwing', () => {
    expect(mapLegacyStatus('some_future_status')).toBe('error');
  });
});

describe('nextSkip', () => {
  it('dry-run: advances skip by batchSize (filter never shrinks, safe to paginate)', () => {
    expect(nextSkip(0, 500, true)).toBe(500);
    expect(nextSkip(500, 500, true)).toBe(1000);
  });

  it('execute: always resets to 0 (each write shrinks the filter — re-read the new first page)', () => {
    expect(nextSkip(0, 500, false)).toBe(0);
    expect(nextSkip(500, 500, false)).toBe(0);
    expect(nextSkip(11500, 500, false)).toBe(0);
  });
});

describe('backfillStoreListings', () => {
  const FALLBACK_STORE_ID = '6a00000000000000000000f0';

  function makeListing(overrides: Partial<ListingRow> = {}): ListingRow {
    return {
      _id: new Types.ObjectId(),
      productId: new Types.ObjectId(),
      marketplaceId: new Types.ObjectId(),
      externalId: 'MLB123',
      status: 'active',
      createdByUserId: null,
      ...overrides,
    };
  }

  it('dry-run: counts without calling storeListingService', async () => {
    const listing = makeListing();
    const storeListingService = {
      findByProductAndStore: jest.fn(),
      create: jest.fn(),
      createMarketplaceListing: jest.fn(),
    };

    const summary = await backfillStoreListings({
      listings: [listing],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      resolveMarketplaceTag: async () => 'mercadolivre',
      resolveAccountId: async () => 'account-1',
      listingModel: { updateOne: jest.fn() } as any,
      dryRun: true,
    });

    expect(summary.totalListings).toBe(1);
    expect(summary.resolvedViaFallback).toBe(1);
    expect(storeListingService.create).not.toHaveBeenCalled();
  });

  it('execute: creates a new StoreListing and MarketplaceListing when none exists', async () => {
    const listing = makeListing();
    const storeListingService = {
      findByProductAndStore: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'SL1' }),
      createMarketplaceListing: jest.fn().mockResolvedValue({ id: 'ML1' }),
    };
    const listingModel = { updateOne: jest.fn().mockResolvedValue({}) };

    const summary = await backfillStoreListings({
      listings: [listing],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      resolveMarketplaceTag: async () => 'mercadolivre',
      resolveAccountId: async () => 'account-1',
      listingModel: listingModel as any,
      dryRun: false,
    });

    expect(storeListingService.create).toHaveBeenCalledWith(String(listing.productId), FALLBACK_STORE_ID);
    expect(storeListingService.createMarketplaceListing).toHaveBeenCalledWith('SL1', 'mercadolivre', 'account-1', {
      externalId: 'MLB123',
      status: 'active',
    });
    expect(listingModel.updateOne).toHaveBeenCalledWith({ _id: listing._id }, { $set: { storeId: FALLBACK_STORE_ID } });
    expect(summary.storeListingsCreated).toBe(1);
    expect(summary.marketplaceListingsCreated).toBe(1);
  });

  it('execute: reuses an existing StoreListing for the same (productId, storeId)', async () => {
    const listing = makeListing();
    const storeListingService = {
      findByProductAndStore: jest.fn().mockResolvedValue({ id: 'SL-EXISTING' }),
      create: jest.fn(),
      createMarketplaceListing: jest.fn().mockResolvedValue({ id: 'ML1' }),
    };
    const listingModel = { updateOne: jest.fn().mockResolvedValue({}) };

    const summary = await backfillStoreListings({
      listings: [listing],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      resolveMarketplaceTag: async () => 'mercadolivre',
      resolveAccountId: async () => 'account-1',
      listingModel: listingModel as any,
      dryRun: false,
    });

    expect(storeListingService.create).not.toHaveBeenCalled();
    expect(storeListingService.createMarketplaceListing).toHaveBeenCalledWith('SL-EXISTING', 'mercadolivre', 'account-1', {
      externalId: 'MLB123',
      status: 'active',
    });
    expect(summary.storeListingsReused).toBe(1);
  });

  it('two listings of the same product on different marketplaces reuse one StoreListing, create two MarketplaceListings', async () => {
    const productId = new Types.ObjectId();
    const listingA = makeListing({ productId, marketplaceId: new Types.ObjectId() });
    const listingB = makeListing({ productId, marketplaceId: new Types.ObjectId() });
    const storeListingService = {
      findByProductAndStore: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'SL1' }),
      create: jest.fn().mockResolvedValue({ id: 'SL1' }),
      createMarketplaceListing: jest.fn().mockResolvedValue({ id: 'ML-X' }),
    };
    const listingModel = { updateOne: jest.fn().mockResolvedValue({}) };

    const summary = await backfillStoreListings({
      listings: [listingA, listingB],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      resolveMarketplaceTag: async () => 'mercadolivre',
      resolveAccountId: async () => 'account-1',
      listingModel: listingModel as any,
      dryRun: false,
    });

    expect(summary.storeListingsCreated).toBe(1);
    expect(summary.storeListingsReused).toBe(1);
    expect(summary.marketplaceListingsCreated).toBe(2);
  });

  it('running backfillStoreListings a second time on the same listing does not throw and increments marketplaceListingsReused instead of marketplaceListingsCreated', async () => {
    const listing = makeListing();
    const storeListingService = {
      findByProductAndStore: jest.fn().mockResolvedValue({ id: 'SL-EXISTING' }),
      create: jest.fn(),
      createMarketplaceListing: jest.fn().mockRejectedValue(
        new BadRequestException('Já existe uma publicação em mercadolivre para este StoreListing.'),
      ),
    };
    const listingModel = { updateOne: jest.fn().mockResolvedValue({}) };

    const summary = await backfillStoreListings({
      listings: [listing],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      resolveMarketplaceTag: async () => 'mercadolivre',
      resolveAccountId: async () => 'account-1',
      listingModel: listingModel as any,
      dryRun: false,
    });

    expect(summary.marketplaceListingsReused).toBe(1);
    expect(summary.marketplaceListingsCreated).toBe(0);
  });

  it('two listings of the SAME product+marketplace with DIFFERENT externalId both get their own MarketplaceListing (not treated as duplicates)', async () => {
    const productId = new Types.ObjectId();
    const marketplaceId = new Types.ObjectId();
    const listingA = makeListing({ productId, marketplaceId, externalId: 'MLB111', _id: new Types.ObjectId() });
    const listingB = makeListing({ productId, marketplaceId, externalId: 'MLB222', _id: new Types.ObjectId() });

    const storeListingService = {
      findByProductAndStore: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'SL1' }), // same product -> same StoreListing reused on 2nd call
      create: jest.fn().mockResolvedValue({ id: 'SL1' }),
      createMarketplaceListing: jest.fn()
        .mockResolvedValueOnce({ id: 'ML1' })
        .mockResolvedValueOnce({ id: 'ML2' }), // both succeed — different externalId
    };
    const listingModel = { updateOne: jest.fn().mockResolvedValue({}) };

    const summary = await backfillStoreListings({
      listings: [listingA, listingB],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      resolveMarketplaceTag: async () => 'mercadolivre',
      resolveAccountId: async () => 'ACC_A',
      listingModel: listingModel as any,
      dryRun: false,
    });

    expect(summary.storeListingsCreated).toBe(1);
    expect(summary.storeListingsReused).toBe(1);
    expect(summary.marketplaceListingsCreated).toBe(2); // NOT 1 created + 1 reused — this is the bug this plan fixes
    expect(summary.marketplaceListingsReused).toBe(0);
  });

  it('resolved account creates the MarketplaceListing normally', async () => {
    const listing = makeListing();
    const storeListingService = {
      findByProductAndStore: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'SL1' }),
      createMarketplaceListing: jest.fn().mockResolvedValue({ id: 'ML1' }),
    };
    const listingModel = { updateOne: jest.fn().mockResolvedValue({}) };

    const summary = await backfillStoreListings({
      listings: [listing],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      resolveMarketplaceTag: async () => 'mercadolivre',
      resolveAccountId: async () => 'account-1',
      listingModel: listingModel as any,
      dryRun: false,
    });

    expect(storeListingService.createMarketplaceListing).toHaveBeenCalledWith('SL1', 'mercadolivre', 'account-1', {
      externalId: 'MLB123',
      status: 'active',
    });
    expect(summary.marketplaceListingsCreated).toBe(1);
    expect(summary.skippedNoAccount).toBe(0);
  });

  it('null account increments skippedNoAccount and does not call createMarketplaceListing', async () => {
    const listing = makeListing();
    const storeListingService = {
      findByProductAndStore: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'SL1' }),
      createMarketplaceListing: jest.fn(),
    };
    const listingModel = { updateOne: jest.fn().mockResolvedValue({}) };

    const summary = await backfillStoreListings({
      listings: [listing],
      resolveStore: async () => FALLBACK_STORE_ID,
      storeListingService: storeListingService as any,
      resolveMarketplaceTag: async () => 'mercadolivre',
      resolveAccountId: async () => null,
      listingModel: listingModel as any,
      dryRun: false,
    });

    expect(storeListingService.createMarketplaceListing).not.toHaveBeenCalled();
    expect(summary.skippedNoAccount).toBe(1);
    expect(summary.marketplaceListingsCreated).toBe(0);
    // storeId is still backfilled onto the listing even when the marketplace listing is skipped
    expect(listingModel.updateOne).toHaveBeenCalledWith({ _id: listing._id }, { $set: { storeId: FALLBACK_STORE_ID } });
  });
});

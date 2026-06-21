import { ModerationIngestService } from './moderation-ingest.service';
import { CanonicalModeration } from '../providers/moderation-provider.types';

describe('ModerationIngestService', () => {
  let service: ModerationIngestService;
  let listingModel: { findOne: jest.Mock };
  let productModel: { findById: jest.Mock };
  let repo: { upsertOpen: jest.Mock };
  let handlers: { get: jest.Mock };
  let handler: { type: string; handle: jest.Mock };

  const canonical: CanonicalModeration = {
    marketplace: 'mercadolivre',
    externalId: 'MLB123',
    type: 'WRONG_CATEGORY',
    subgroup: 'DOMAIN',
    reason: 'x',
  };

  beforeEach(() => {
    listingModel = { findOne: jest.fn() };
    productModel = { findById: jest.fn().mockResolvedValue({ _id: 'P1' }) };
    repo = { upsertOpen: jest.fn().mockResolvedValue({ _id: 'S1', blockedCategoryId: null }) };
    handler = { type: 'WRONG_CATEGORY', handle: jest.fn().mockResolvedValue(undefined) };
    handlers = { get: jest.fn().mockReturnValue(handler) };
    service = new ModerationIngestService(
      listingModel as any,
      productModel as any,
      repo as any,
      handlers as any,
    );
  });

  it('resolves listing+product, upserts state, runs handler', async () => {
    const listing = { _id: 'L1', productId: 'P1' };
    listingModel.findOne.mockResolvedValue(listing);

    const res = await service.ingest('M1', null, canonical, 'MLB-OLD');

    expect(res.outcome).toBe('handled');
    expect(repo.upsertOpen).toHaveBeenCalledWith(
      canonical,
      expect.objectContaining({
        marketplaceId: 'M1',
        accountId: null,
        listingId: 'L1',
        productId: 'P1',
        blockedCategoryId: 'MLB-OLD',
      }),
    );
    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({ listing, canonical, state: { _id: 'S1', blockedCategoryId: null } }),
    );
  });

  it('skips when no local listing matches (no_listing)', async () => {
    listingModel.findOne.mockResolvedValue(null);

    const res = await service.ingest('M1', null, canonical);

    expect(res.outcome).toBe('no_listing');
    expect(repo.upsertOpen).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('skips when no handler is registered for the type (no_handler)', async () => {
    listingModel.findOne.mockResolvedValue({ _id: 'L1', productId: 'P1' });
    handlers.get.mockReturnValue(undefined);

    const res = await service.ingest('M1', null, { ...canonical, type: 'PHOTO_QUALITY' });

    expect(res.outcome).toBe('no_handler');
    expect(repo.upsertOpen).not.toHaveBeenCalled();
  });
});

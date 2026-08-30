import { Types } from 'mongoose';
import { MarketplaceIssuesService } from './marketplace-issues.service';

describe('MarketplaceIssuesService', () => {
  let service: MarketplaceIssuesService;
  let listingModel: any;
  let categoryModel: any;
  let orchestratorPublisher: any;
  let productService: any;
  let marketplaceRegistry: any;
  let moderationRepo: any;

  beforeEach(() => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    listingModel = {
      find: jest.fn().mockReturnValue(query),
      countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) }),
    };
    categoryModel = {};
    orchestratorPublisher = {};
    productService = {};
    marketplaceRegistry = { findByTag: jest.fn() };
    moderationRepo = { findOpenByListingIds: jest.fn().mockResolvedValue(new Map()) };

    service = new MarketplaceIssuesService(
      listingModel,
      categoryModel,
      orchestratorPublisher,
      productService,
      marketplaceRegistry,
      moderationRepo,
    );
  });

  it('filters listings by storeId as an ObjectId when provided', async () => {
    const storeId = new Types.ObjectId().toString();

    await service.listIssues({ storeId });

    const filter = listingModel.find.mock.calls[0][0];
    expect(filter.storeId).toBeInstanceOf(Types.ObjectId);
    expect(String(filter.storeId)).toBe(storeId);
  });

  it('omits the storeId filter when not provided', async () => {
    await service.listIssues({});

    const filter = listingModel.find.mock.calls[0][0];
    expect(filter.storeId).toBeUndefined();
  });
});

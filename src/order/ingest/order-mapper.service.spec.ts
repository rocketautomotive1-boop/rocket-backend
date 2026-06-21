import { OrderMapperService } from './order-mapper.service';
import { ProductResolverPort } from '../ports/product-resolver.port';

describe('OrderMapperService', () => {
  let mapper: OrderMapperService;

  const resolver: jest.Mocked<ProductResolverPort> = {
    resolveProducts: jest.fn().mockResolvedValue(new Map<number, string | null>()),
    getCostPrices: jest.fn().mockResolvedValue(new Map<string, number>()),
  } as any;

  const marketplaceId = '650000000000000000000099';

  beforeEach(() => {
    jest.clearAllMocks();
    mapper = new OrderMapperService(resolver);
  });

  it('maps the marketplace date_created into marketplaceCreatedAt', async () => {
    const externalOrder = {
      id: 'EXT-1',
      status: 'paid',
      total_amount: 100,
      date_created: '2026-06-18T14:21:21.000-04:00',
      items: [],
    };

    const domain = await mapper.mapToDomain(externalOrder, marketplaceId);

    expect(domain.marketplaceCreatedAt).toEqual(new Date('2026-06-18T14:21:21.000-04:00'));
  });

  it('leaves marketplaceCreatedAt undefined when the marketplace omits date_created', async () => {
    const externalOrder = {
      id: 'EXT-2',
      status: 'paid',
      total_amount: 50,
      items: [],
    };

    const domain = await mapper.mapToDomain(externalOrder, marketplaceId);

    expect(domain.marketplaceCreatedAt).toBeUndefined();
  });
});

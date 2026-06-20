import { AmazonProductAdapter } from './amazon-product.adapter';

/**
 * Após a migração para AmazonHttpClient, o adapter de produto é negócio puro:
 * monta o payload SP-API e chama http.request (PUT /listings). Token, SigV4 e
 * auth-retry vivem no AmazonHttpClient — o adapter não vê nada disso.
 */
describe('AmazonProductAdapter', () => {
  const OLD_SELLER = process.env.AMAZON_SELLER_ID;
  beforeAll(() => { process.env.AMAZON_SELLER_ID = 'SELLER1'; });
  afterAll(() => { process.env.AMAZON_SELLER_ID = OLD_SELLER; });

  const descriptionService = { generateDescription: jest.fn().mockResolvedValue('') };

  function makeAdapter(httpRequest: jest.Mock): AmazonProductAdapter {
    const http = { request: httpRequest };
    return new (AmazonProductAdapter as any)(
      {},                  // listingService (não usado em createProduct direto)
      descriptionService,
      http,
    );
  }

  beforeEach(() => jest.clearAllMocks());

  it('PUTs the listing via http.request and returns success', async () => {
    const httpRequest = jest.fn().mockResolvedValue({ data: { status: 'ACCEPTED' } });
    const adapter = makeAdapter(httpRequest);

    const out = await adapter.createProduct({ id: 'SKU1', name: 'Pastilha', price: 99 });

    expect(out.success).toBe(true);
    expect(out.externalId).toBe('SKU1');
    const spec = httpRequest.mock.calls[0][0];
    expect(spec.method).toBe('PUT');
    expect(spec.path).toBe('/listings/2021-08-01/items/SELLER1/SKU1');
    expect(spec.query).toMatchObject({ marketplaceIds: expect.any(String) });
    expect(spec.body.attributes.item_name[0].value).toBe('Pastilha');
  });

  it('maps an INVALID response to a failure result with issues', async () => {
    const httpRequest = jest.fn().mockResolvedValue({ data: { status: 'INVALID', issues: [{ message: 'bad' }] } });
    const adapter = makeAdapter(httpRequest);

    const out = await adapter.createProduct({ id: 'SKU2', name: 'X', price: 10 });

    expect(out.success).toBe(false);
    expect(out.error).toContain('Issues');
  });

  it('rejects when no Seller ID is configured', async () => {
    process.env.AMAZON_SELLER_ID = '';
    const adapter = makeAdapter(jest.fn());

    await expect(adapter.createProduct({ id: 'SKU3', name: 'X', price: 10 }))
      .rejects.toThrow(/Seller ID/);

    process.env.AMAZON_SELLER_ID = 'SELLER1';
  });
});

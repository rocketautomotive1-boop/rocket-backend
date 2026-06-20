import { AmazonProductAdapter } from './amazon-product.adapter';
import { AuthRetryService } from '../shared/auth-retry.service';

/**
 * Amazon sinaliza falha de auth no PAYLOAD (success:false + Unauthorized), não
 * só lançando. O executeWithRetry deve passar isso ao AuthRetryService e forçar
 * refresh + retry — sem usar o legado marketplaceService.refreshToken.
 */
describe('AmazonProductAdapter auth-retry (result-level)', () => {
  const tokenManager = {
    resolveToken: jest.fn().mockResolvedValue({ accessToken: 'OLD', additionalData: {}, strategy: 'oauth2', fromDatabase: true }),
    forceRefresh: jest.fn().mockResolvedValue({ accessToken: 'NEW', additionalData: {}, strategy: 'oauth2', fromDatabase: true }),
  };
  const authRetry = new AuthRetryService(tokenManager as any);
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'AMZID' }) };

  function makeAdapter(createProduct: jest.Mock): AmazonProductAdapter {
    const adapter = new (AmazonProductAdapter as any)(
      { get: () => undefined }, // moduleRef (overridden below)
      {},                       // listingService
    );
    adapter.getAuthRetry = () => authRetry;
    adapter.getMarketplaceRegistry = () => marketplaceRegistry;
    adapter.createProduct = createProduct;
    adapter.updateProduct = jest.fn();
    return adapter;
  }

  beforeEach(() => jest.clearAllMocks());

  it('refreshes + retries when the result payload is Unauthorized', async () => {
    const createProduct = jest
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'Unauthorized' })
      .mockResolvedValueOnce({ success: true, externalId: 'ASIN1' });
    const adapter = makeAdapter(createProduct);

    const out = await (adapter as any).executeWithRetry({ name: 'x' }, { _id: 'AMZID' });

    expect(out.success).toBe(true);
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    expect(createProduct).toHaveBeenCalledTimes(2);
  });

  it('no refresh when the create succeeds', async () => {
    const createProduct = jest.fn().mockResolvedValueOnce({ success: true, externalId: 'ASIN2' });
    const adapter = makeAdapter(createProduct);

    await (adapter as any).executeWithRetry({ name: 'x' }, { _id: 'AMZID' });

    expect(tokenManager.forceRefresh).not.toHaveBeenCalled();
  });
});

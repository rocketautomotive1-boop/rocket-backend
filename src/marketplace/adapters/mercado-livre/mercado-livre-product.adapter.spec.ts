import axios from 'axios';
import { MercadoLivreProductAdapter } from './mercado-livre-product.adapter';
import { AuthRetryService } from '../shared/auth-retry.service';

jest.mock('axios');

/**
 * Foca no auth-retry: createProduct deve rotear o refresh pela CONTA DO DOMÍNIO
 * (selector {domain}) e retentar 1x, sem tocar no legado marketplaceService.refreshToken.
 */
describe('MercadoLivreProductAdapter auth-retry', () => {
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'MLID' }) };
  const tokenManager = {
    resolveToken: jest.fn().mockResolvedValue({ accessToken: 'OLD', additionalData: {}, strategy: 'oauth2', fromDatabase: true }),
    forceRefresh: jest.fn().mockResolvedValue({ accessToken: 'NEW', additionalData: {}, strategy: 'oauth2', fromDatabase: true }),
  };
  const authRetry = new AuthRetryService(tokenManager as any);

  function makeAdapter(): MercadoLivreProductAdapter {
    // Só as deps usadas no caminho de createProduct/createNewProduct precisam ser reais.
    const adapter = new (MercadoLivreProductAdapter as any)(
      {},                    // authAdapter
      {},                    // productService
      {},                    // helperService
      { /* descriptionService */ },
      { registerProductAdapter: jest.fn() }, // registry
      {},                    // listingAdapter
      {},                    // listingService
      marketplaceRegistry,   // marketplaceRegistry
      authRetry,             // authRetry
    );
    // updateProductDescription é best-effort e não relevante aqui
    adapter.updateProductDescription = jest.fn().mockResolvedValue(undefined);
    // buildMercadoLivreCreateData precisa de muito contexto — stub mínimo
    adapter.buildMercadoLivreCreateData = jest.fn().mockReturnValue({ title: 'x' });
    return adapter;
  }

  beforeEach(() => jest.clearAllMocks());

  it('on 401 forces refresh by {domain} and retries the create', async () => {
    const adapter = makeAdapter();
    (axios.post as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 401 } })          // create (OLD) → 401
      .mockResolvedValueOnce({ status: 201, data: { id: 'MLB9' } }); // create (NEW) ok

    const res = await adapter.createProduct({ name: 'Item', domain: 'general' });

    expect(res.success).toBe(true);
    expect(res.externalId).toBe('MLB9');
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    expect(tokenManager.forceRefresh).toHaveBeenCalledWith('MLID', { domain: 'general' });
  });

  it('does not refresh on success', async () => {
    const adapter = makeAdapter();
    (axios.post as jest.Mock).mockResolvedValueOnce({ status: 201, data: { id: 'MLB1' } });

    await adapter.createProduct({ name: 'Item', domain: 'autopecas' });

    expect(tokenManager.forceRefresh).not.toHaveBeenCalled();
  });
});

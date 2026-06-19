import { Test } from '@nestjs/testing';
import axios from 'axios';
import { MercadoLivreOrderAdapter } from './mercado-livre-order.adapter';
import { MercadoLivreAuthAdapter } from './mercado-livre-auth.adapter';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';

jest.mock('axios');

describe('MercadoLivreOrderAdapter retry', () => {
  let adapter: MercadoLivreOrderAdapter;
  const auth = {
    getValidToken: jest.fn(),
    forceRefreshAccessToken: jest.fn(),
    me: jest.fn(),
  };
  const registry = { registerOrderAdapter: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MercadoLivreOrderAdapter,
        { provide: MercadoLivreAuthAdapter, useValue: auth },
        { provide: MarketplaceAdapterRegistry, useValue: registry },
      ],
    }).compile();
    adapter = moduleRef.get(MercadoLivreOrderAdapter);
  });

  it('refreshes the SAME accountId that failed with 401', async () => {
    auth.getValidToken.mockResolvedValue('OLD');
    auth.me.mockResolvedValue({ id: 123 });
    // operation: first axios.get throws 401, retry resolves empty
    (axios.get as jest.Mock)
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce({ data: { results: [] } });
    auth.forceRefreshAccessToken.mockResolvedValue('NEW');

    const result = await adapter.getOrders({ accountId: 'ACC_B' });

    expect(result).toEqual([]);
    expect(auth.forceRefreshAccessToken).toHaveBeenCalledWith('Mercado Livre', { accountId: 'ACC_B' });
  });
});

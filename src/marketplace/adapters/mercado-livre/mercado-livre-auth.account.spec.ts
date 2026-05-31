// backend/src/marketplace/adapters/mercado-livre/mercado-livre-auth.account.spec.ts
import axios from 'axios';
import { MercadoLivreAuthAdapter } from './mercado-livre-auth.adapter';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// authService is only used by legacy methods; the *ForAccount methods don't need it.
const adapter = () => new MercadoLivreAuthAdapter({} as any);

describe('MercadoLivreAuthAdapter — per-account OAuth (uses account credentials, not env)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generateAuthUrlForAccount builds the URL with the account clientId', () => {
    const { authUrl } = adapter().generateAuthUrlForAccount('ACCOUNT_CLIENT_ID', 'https://cb');
    expect(authUrl).toContain('client_id=ACCOUNT_CLIENT_ID');
    expect(authUrl).toContain('redirect_uri=' + encodeURIComponent('https://cb'));
    expect(authUrl).toContain('response_type=code');
  });

  it('authenticateForAccount exchanges code using the account credentials', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'AT', refresh_token: 'RT', expires_in: 21600, token_type: 'bearer', scope: 's', user_id: 9 },
    } as any);

    const result = await adapter().authenticateForAccount('CODE', 'CID', 'CSECRET', 'https://cb');

    const [, body] = mockedAxios.post.mock.calls[0];
    const sent = body as URLSearchParams;
    expect(sent.get('client_id')).toBe('CID');
    expect(sent.get('client_secret')).toBe('CSECRET');
    expect(sent.get('code')).toBe('CODE');
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(result.accessToken).toBe('AT');
    expect(result.refreshToken).toBe('RT');
    expect(result.additionalData.clientId).toBe('CID');
  });

  it('refreshTokenForAccount renews using the account credentials', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { access_token: 'AT2', refresh_token: 'RT2', expires_in: 21600, token_type: 'bearer' },
    } as any);

    const result = await adapter().refreshTokenForAccount(
      { refreshToken: 'OLD_RT', additionalData: {} },
      'CID',
      'CSECRET',
    );

    const [, body] = mockedAxios.post.mock.calls[0];
    expect((body as any).client_id).toBe('CID');
    expect((body as any).client_secret).toBe('CSECRET');
    expect((body as any).refresh_token).toBe('OLD_RT');
    expect((body as any).grant_type).toBe('refresh_token');
    expect(result.accessToken).toBe('AT2');
  });
});

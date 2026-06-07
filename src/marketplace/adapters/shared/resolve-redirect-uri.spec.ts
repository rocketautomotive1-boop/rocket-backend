import { resolveRedirectUri } from './resolve-redirect-uri';

describe('resolveRedirectUri', () => {
  it('settings.redirectUri vence o fallback do .env', () => {
    const mkt: any = { settings: { redirectUri: 'https://app/from-settings' } };
    expect(resolveRedirectUri(mkt, 'https://env/fallback')).toBe('https://app/from-settings');
  });

  it('marketplace null → usa o fallback do .env', () => {
    expect(resolveRedirectUri(null, 'https://env/fallback')).toBe('https://env/fallback');
  });

  it('settings vazio (sem redirectUri) → usa o fallback do .env', () => {
    const mkt: any = { settings: {} };
    expect(resolveRedirectUri(mkt, 'https://env/fallback')).toBe('https://env/fallback');
  });

  it('nada configurado → string vazia', () => {
    expect(resolveRedirectUri(null, undefined)).toBe('');
  });
});

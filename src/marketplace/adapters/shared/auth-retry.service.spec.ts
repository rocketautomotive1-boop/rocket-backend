import { AuthRetryService } from './auth-retry.service';
import { ResolvedToken } from '../../auth/services/token-manager.service';

function tok(accessToken: string, extra: Partial<ResolvedToken> = {}): ResolvedToken {
  return {
    accessToken,
    strategy: 'oauth2',
    fromDatabase: true,
    additionalData: {},
    ...extra,
  };
}

function makeSut() {
  const tokenManager = {
    resolveToken: jest.fn().mockResolvedValue(tok('OLD')),
    forceRefresh: jest.fn().mockResolvedValue(tok('NEW')),
  };
  const sut = new AuthRetryService(tokenManager as any);
  return { sut, tokenManager };
}

const err = (status?: number, data?: any, message?: string) => ({
  response: status !== undefined ? { status, data } : undefined,
  message,
});

describe('AuthRetryService.isAuthError', () => {
  it.each([
    ['401 status', err(401)],
    ['403 status', err(403)],
    ['invalid_token in data.message', err(400, { message: 'invalid_token' })],
    ['invalid_access_token in data.error', err(400, { error: 'invalid_access_token' })],
    ['error_auth', err(400, { error: 'error_auth' })],
    ['Unauthorized message', err(undefined, undefined, 'Unauthorized')],
    ['access token expired', err(400, { message: 'access token expired' })],
    ['token you provided has expired', err(400, { message: 'token you provided has expired' })],
    ['Access to requested resource is denied', err(400, { message: 'Access to requested resource is denied' })],
  ])('returns true for %s', (_label, e) => {
    expect(AuthRetryService.isAuthError(e)).toBe(true);
  });

  it.each([
    ['404', err(404)],
    ['500', err(500, { message: 'internal' })],
    ['plain network error', { message: 'ECONNRESET' }],
    ['undefined', undefined],
  ])('returns false for %s', (_label, e) => {
    expect(AuthRetryService.isAuthError(e)).toBe(false);
  });
});

describe('AuthRetryService.run', () => {
  it('happy path: op succeeds once, no refresh', async () => {
    const { sut, tokenManager } = makeSut();
    const op = jest.fn().mockResolvedValue('ok');
    const out = await sut.run({ marketplaceId: 'MP', context: 'getX' }, op);
    expect(out).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
    expect(tokenManager.forceRefresh).not.toHaveBeenCalled();
  });

  it('auth error: forces refresh of the SAME selector and retries once', async () => {
    const { sut, tokenManager } = makeSut();
    const op = jest
      .fn()
      .mockRejectedValueOnce(err(401))
      .mockResolvedValueOnce('recovered');
    const out = await sut.run(
      { marketplaceId: 'MP', selector: { accountId: 'ACC_B' }, context: 'getOrders' },
      op,
    );
    expect(out).toBe('recovered');
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    expect(tokenManager.forceRefresh).toHaveBeenCalledWith('MP', { accountId: 'ACC_B' });
    // retried with the refreshed token
    expect(op).toHaveBeenCalledTimes(2);
    expect(op.mock.calls[1][0].accessToken).toBe('NEW');
  });

  it('single-retry: second throw propagates (no third op call)', async () => {
    const { sut, tokenManager } = makeSut();
    const op = jest.fn().mockRejectedValue(err(401));
    await expect(sut.run({ marketplaceId: 'MP', context: 'c' }, op)).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(2);
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
  });

  it('refresh failure: rethrows the ORIGINAL error', async () => {
    const { sut, tokenManager } = makeSut();
    const original = err(401, { message: 'invalid_token' });
    const op = jest.fn().mockRejectedValue(original);
    tokenManager.forceRefresh.mockRejectedValue(new Error('invalid_grant'));
    await expect(sut.run({ marketplaceId: 'MP', context: 'c' }, op)).rejects.toBe(original);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('non-auth error: propagates without refresh', async () => {
    const { sut, tokenManager } = makeSut();
    const op = jest.fn().mockRejectedValue(err(500));
    await expect(sut.run({ marketplaceId: 'MP', context: 'c' }, op)).rejects.toBeDefined();
    expect(op).toHaveBeenCalledTimes(1);
    expect(tokenManager.forceRefresh).not.toHaveBeenCalled();
  });

  it('result-level auth failure (Amazon): refresh + retry', async () => {
    const { sut, tokenManager } = makeSut();
    const bad = { success: false, error: 'Unauthorized' };
    const good = { success: true };
    const op = jest.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    const out = await sut.run(
      {
        marketplaceId: 'MP',
        context: 'createProduct',
        isAuthFailureResult: (r: any) => r?.success === false && /Unauthorized/i.test(r?.error ?? ''),
      },
      op,
    );
    expect(out).toBe(good);
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('result-level still bad after retry: returns the second result (no loop)', async () => {
    const { sut, tokenManager } = makeSut();
    const bad = { success: false, error: 'Unauthorized' };
    const op = jest.fn().mockResolvedValue(bad);
    const out = await sut.run(
      {
        marketplaceId: 'MP',
        context: 'createProduct',
        isAuthFailureResult: (r: any) => r?.success === false,
      },
      op,
    );
    expect(out).toBe(bad);
    expect(op).toHaveBeenCalledTimes(2);
    expect(tokenManager.forceRefresh).toHaveBeenCalledTimes(1);
  });

  it('resolves the initial token via tokenManager.resolveToken with selector', async () => {
    const { sut, tokenManager } = makeSut();
    const op = jest.fn().mockResolvedValue('ok');
    await sut.run({ marketplaceId: 'MP', selector: { domain: 'general' }, context: 'c' }, op);
    expect(tokenManager.resolveToken).toHaveBeenCalledWith('MP', { domain: 'general' });
  });
});

import axios from 'axios';
import {
  MarketplaceHttpClient,
  HttpRequestSpec,
  SignedRequest,
} from './marketplace-http-client';
import { ResolvedToken } from '../../auth/services/token-manager.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const token: ResolvedToken = {
  accessToken: 'TKN',
  strategy: 'oauth2',
  fromDatabase: true,
  additionalData: {},
};

/** Subclasse mínima de teste — sign trivial Bearer. */
class TestHttpClient extends MarketplaceHttpClient {
  protected marketplaceName(): string { return 'Mercado Livre'; }
  protected baseUrl(): string { return 'https://api.example.com'; }
  protected async sign(spec: HttpRequestSpec, t: ResolvedToken): Promise<SignedRequest> {
    return {
      url: `${this.baseUrl()}${spec.path}`,
      config: { params: spec.query, headers: { Authorization: `Bearer ${t.accessToken}` } },
    };
  }
}

function rateLimitError(retryAfter?: string) {
  return {
    response: {
      status: 429,
      data: { message: 'local_rate_limited' },
      headers: retryAfter ? { 'retry-after': retryAfter } : {},
    },
  };
}

function makeSut() {
  // authRetry.run apenas resolve o token e executa o op (sem retry de auth aqui).
  const authRetry = { run: jest.fn((_args: any, op: any) => op(token)) };
  const marketplaceRegistry = { findByName: jest.fn().mockResolvedValue({ _id: 'mkt1' }) };
  const sut = new TestHttpClient(authRetry as any, marketplaceRegistry as any);
  return { sut, authRetry, marketplaceRegistry };
}

describe('MarketplaceHttpClient — helpers de rate limit', () => {
  it('isRateLimited detecta 429 por status', () => {
    expect(MarketplaceHttpClient.isRateLimited(rateLimitError())).toBe(true);
  });

  it('isRateLimited detecta local_rate_limited na mensagem (sem status 429)', () => {
    expect(
      MarketplaceHttpClient.isRateLimited({ response: { status: 400, data: { message: 'local_rate_limited' } } }),
    ).toBe(true);
  });

  it('isRateLimited é false p/ erro de auth', () => {
    expect(MarketplaceHttpClient.isRateLimited({ response: { status: 403, data: {} } })).toBe(false);
  });

  it('resolveRetryDelayMs usa Retry-After (segundos→ms) quando presente', () => {
    expect(MarketplaceHttpClient.resolveRetryDelayMs(rateLimitError('2'), 999)).toBe(2000);
  });

  it('resolveRetryDelayMs cai no fallback sem Retry-After', () => {
    expect(MarketplaceHttpClient.resolveRetryDelayMs(rateLimitError(), 777)).toBe(777);
  });
});

describe('MarketplaceHttpClient — request com retry de 429', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retenta em 429 e retorna ao obter sucesso', async () => {
    const { sut } = makeSut();
    mockedAxios.request
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce({ data: { ok: true } } as any);

    const promise = sut.get('/x', { context: 'test' });
    await jest.runAllTimersAsync();
    const data = await promise;

    expect(data).toEqual({ ok: true });
    expect(mockedAxios.request).toHaveBeenCalledTimes(2);
  });

  it('NÃO retenta em erro não-429 (relança imediatamente)', async () => {
    const { sut } = makeSut();
    mockedAxios.request.mockRejectedValueOnce({ response: { status: 500, data: {} } });

    await expect(sut.get('/x', { context: 'test' })).rejects.toMatchObject({
      response: { status: 500 },
    });
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });

  it('esgota os retries de 429 e relança o erro', async () => {
    const { sut } = makeSut();
    mockedAxios.request.mockRejectedValue(rateLimitError());

    const promise = sut.get('/x', { context: 'test' });
    const assertion = expect(promise).rejects.toMatchObject({ response: { status: 429 } });
    await jest.runAllTimersAsync();
    await assertion;

    // 1 tentativa inicial + 3 retries (RATE_LIMIT_BACKOFF_MS tem 3 itens)
    expect(mockedAxios.request).toHaveBeenCalledTimes(4);
  });

  it('passa accountId como selector para o authRetry', async () => {
    const { sut, authRetry } = makeSut();
    mockedAxios.request.mockResolvedValueOnce({ data: {} } as any);

    await sut.get('/x', { accountId: 'acc1', context: 'test' });

    expect(authRetry.run).toHaveBeenCalledWith(
      expect.objectContaining({ selector: { accountId: 'acc1' }, context: 'test' }),
      expect.any(Function),
    );
  });
});

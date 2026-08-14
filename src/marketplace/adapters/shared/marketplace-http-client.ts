import { Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig, AxiosResponse, Method } from 'axios';
import { AuthRetryService } from './auth-retry.service';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { ResolvedToken } from '../../auth/services/token-manager.service';

/** Descritor de uma requisição, agnóstico de família. */
export interface HttpRequestSpec {
  method: Method;
  /** Path relativo à baseUrl (ex.: '/orders/search'). */
  path: string;
  /** Query params (antes da assinatura). */
  query?: Record<string, any>;
  /** Corpo JSON. */
  body?: any;
  /** Headers extra (mesclados com os da família). */
  headers?: Record<string, string>;
  /** Config axios extra pass-through (ex.: maxBodyLength p/ multipart). */
  axiosConfig?: AxiosRequestConfig;
}

/** Roteamento de conta para o auth-retry (accountId > domain). */
export interface HttpAuthContext {
  accountId?: string;
  domain?: string;
  /** Rótulo p/ logs do auth-retry (ex.: 'getOrders'). */
  context: string;
}

/**
 * Resultado da assinatura/preparação de UMA tentativa: cada família devolve a
 * config axios final (URL, params, headers) a partir do request + token. É
 * recomputada a cada retry (timestamp/sign novos) porque o AuthRetryService
 * re-invoca o `op`.
 */
export interface SignedRequest {
  url: string;
  config: AxiosRequestConfig;
}

/**
 * Base de transporte HTTP por marketplace. Encapsula:
 *  - resolução de marketplaceId (via cache de config),
 *  - auth-retry canônico (AuthRetryService: refresh da conta certa + 1 retry),
 *  - assinatura específica da família (subclasse implementa `sign`).
 *
 * O adapter chama `request(spec, ctx)` e NÃO vê token, refresh nem assinatura —
 * o retry fica invisível. Cada família é uma subclasse com sua própria `sign`.
 */
export abstract class MarketplaceHttpClient {
  protected readonly logger = new Logger(this.constructor.name);

  /** Backoff p/ 429 (rate limit). Cada índice = espera antes da próxima tentativa. */
  private static readonly RATE_LIMIT_BACKOFF_MS = [500, 1500, 4000];

  constructor(
    protected readonly authRetry: AuthRetryService,
    protected readonly marketplaceRegistry: MarketplaceRegistryService,
  ) {}

  /** Nome do marketplace (findByName) — define a família. */
  protected abstract marketplaceName(): string;

  /** Base URL da API da família. */
  protected abstract baseUrl(): string;

  /**
   * Prepara UMA tentativa: a partir do request + token resolvido, produz a
   * config axios final (assinatura, headers de auth, query). Recomputada a cada
   * retry. Pode ser async (Shopee/TikTok resolvem partnerKey/appKey).
   */
  protected abstract sign(spec: HttpRequestSpec, token: ResolvedToken): Promise<SignedRequest>;

  /** Executa o request com auth-retry + assinatura da família. */
  async request<T = any>(spec: HttpRequestSpec, ctx: HttpAuthContext): Promise<AxiosResponse<T>> {
    const mkt = await this.marketplaceRegistry.findByName(this.marketplaceName());
    const selector =
      ctx.accountId ? { accountId: ctx.accountId } : ctx.domain ? { domain: ctx.domain } : undefined;

    return this.authRetry.run<AxiosResponse<T>>(
      { marketplaceId: String(mkt._id), selector, context: ctx.context },
      async (token) => {
        const signed = await this.sign(spec, token);
        return this.requestWithRateLimitRetry<T>({
          method: spec.method,
          url: signed.url,
          ...signed.config,
          ...(spec.axiosConfig ?? {}),
        }, ctx.context);
      },
    );
  }

  /**
   * Executa o axios.request retentando em 429 (rate limit) com backoff. Honra
   * Retry-After quando presente; senão usa backoff exponencial curto. Erros de
   * auth (401/403) NÃO são tratados aqui — sobem para o AuthRetryService.
   */
  private async requestWithRateLimitRetry<T>(
    config: AxiosRequestConfig,
    context: string,
  ): Promise<AxiosResponse<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MarketplaceHttpClient.RATE_LIMIT_BACKOFF_MS.length; attempt++) {
      try {
        return await axios.request<T>(config);
      } catch (error) {
        if (!MarketplaceHttpClient.isRateLimited(error) ||
            attempt === MarketplaceHttpClient.RATE_LIMIT_BACKOFF_MS.length) {
          throw error;
        }
        lastError = error;
        const waitMs = MarketplaceHttpClient.resolveRetryDelayMs(
          error,
          MarketplaceHttpClient.RATE_LIMIT_BACKOFF_MS[attempt],
        );
        this.logger.warn(
          `Rate limit (429) em ${context}; retry ${attempt + 1}/${MarketplaceHttpClient.RATE_LIMIT_BACKOFF_MS.length} em ${waitMs}ms`,
        );
        await MarketplaceHttpClient.delay(waitMs);
      }
    }
    throw lastError;
  }

  /** True se o erro é um 429 (rate limit), incluindo o 'local_rate_limited' do ML. */
  static isRateLimited(error: unknown): boolean {
    const e = error as any;
    if (e?.response?.status === 429) return true;
    const data = e?.response?.data;
    const msg = String(data?.error ?? data?.message ?? '');
    return /rate[_ ]?limit|too many requests/i.test(msg);
  }

  /** Espera do Retry-After (segundos) se presente; senão o fallback. */
  static resolveRetryDelayMs(error: unknown, fallbackMs: number): number {
    const header = (error as any)?.response?.headers?.['retry-after'];
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Açúcar p/ GET; devolve já o response.data. */
  async get<T = any>(path: string, ctx: HttpAuthContext, query?: Record<string, any>): Promise<T> {
    const res = await this.request<T>({ method: 'GET', path, query }, ctx);
    return res.data;
  }

  /** Açúcar p/ POST; devolve já o response.data. */
  async post<T = any>(path: string, ctx: HttpAuthContext, body?: any, query?: Record<string, any>): Promise<T> {
    const res = await this.request<T>({ method: 'POST', path, body, query }, ctx);
    return res.data;
  }
}

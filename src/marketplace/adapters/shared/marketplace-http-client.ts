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
        return axios.request<T>({
          method: spec.method,
          url: signed.url,
          ...signed.config,
          ...(spec.axiosConfig ?? {}),
        });
      },
    );
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

import { Injectable, Logger } from '@nestjs/common';
import { TokenManagerService, ResolvedToken } from '../../auth/services/token-manager.service';

export interface AuthRetryArgs<T> {
  /** ObjectId (string) do marketplace. */
  marketplaceId: string;
  /**
   * Conta a usar/renovar. accountId (entrada/webhook) tem precedência sobre
   * domain (saída/publicação) — herdado de TokenManager.forceRefresh. Omitir =
   * conta default (single-account/legado).
   */
  selector?: { accountId?: string; domain?: string };
  /** Rótulo p/ logs, ex. 'getOrders'. */
  context: string;
  /**
   * Alguns providers (Amazon) sinalizam falha de auth no PAYLOAD de sucesso
   * (success:false) em vez de lançar. Quando fornecido e retornar true, o
   * resultado é tratado como erro de auth (força refresh + 1 retry).
   */
  isAuthFailureResult?: (result: T) => boolean;
}

/**
 * Política ÚNICA de auth-retry dos adapters de marketplace. Substitui os
 * `executeWithRetry`/blocos-401 que cada adapter reimplementava de forma
 * divergente. Resolve o token pelo pipeline canônico (TokenManager) e, no
 * primeiro erro de auth, força a renovação da CONTA CERTA (accountId>domain)
 * e retenta UMA vez. O broker já renova proativamente na leitura, então este
 * caminho reativo só dispara quando o token morre dentro do buffer ou é revogado.
 */
@Injectable()
export class AuthRetryService {
  private readonly logger = new Logger(AuthRetryService.name);

  constructor(private readonly tokenManager: TokenManagerService) {}

  async run<T>(args: AuthRetryArgs<T>, op: (token: ResolvedToken) => Promise<T>): Promise<T> {
    const { marketplaceId, selector, context, isAuthFailureResult } = args;

    const token = await this.tokenManager.resolveToken(marketplaceId, selector);
    try {
      const result = await op(token);
      if (isAuthFailureResult?.(result)) {
        return this.refreshAndRetry(args, op, undefined);
      }
      return result;
    } catch (error) {
      if (!AuthRetryService.isAuthError(error)) throw error;
      return this.refreshAndRetry(args, op, error);
    }
  }

  /** Força refresh da conta certa e retenta o op UMA vez. */
  private async refreshAndRetry<T>(
    args: AuthRetryArgs<T>,
    op: (token: ResolvedToken) => Promise<T>,
    originalError: unknown,
  ): Promise<T> {
    const { marketplaceId, selector, context } = args;
    this.logger.warn(`Erro de autenticação no marketplace (${context}), forçando renovação do token...`);

    let refreshed: ResolvedToken;
    try {
      refreshed = await this.tokenManager.forceRefresh(marketplaceId, selector);
    } catch (refreshError: any) {
      this.logger.error(`Falha ao renovar token durante retry (${context}): ${refreshError?.message}`);
      // Sem token novo não há o que retentar — relança o erro ORIGINAL (mais
      // informativo que "falha no refresh") quando houve um; senão o do refresh.
      throw originalError ?? refreshError;
    }

    this.logger.log(`Token renovado com sucesso para ${context}, tentando novamente...`);
    return op(refreshed);
  }

  /** Heurística de erro de autenticação — superset de todos os providers. */
  static isAuthError(error: unknown): boolean {
    const e = error as any;
    const status = e?.response?.status;
    if (status === 401 || status === 403) return true;

    const data = e?.response?.data;
    const msg = String(data?.error ?? data?.message ?? e?.message ?? '');
    if (!msg) return false;

    return (
      /invalid[_ ]?acce?ss[_ ]?token|invalid_token|error_auth/i.test(msg) ||
      /Unauthorized|access\s*token\s*expired|token you provided has expired/i.test(msg) ||
      /Access to requested resource is denied/i.test(msg)
    );
  }
}

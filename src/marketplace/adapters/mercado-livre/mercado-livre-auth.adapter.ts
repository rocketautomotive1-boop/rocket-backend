import { Injectable, Logger, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { IMarketplaceAuthAdapter, AdapterAccountCredentials } from '../../interfaces/marketplace-auth-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { TokenManagerService } from '../../auth/services/token-manager.service';

/**
 * Adapter de auth do Mercado Livre — PRIMITIVAS HTTP puras do OAuth.
 *
 * Multi-client: as credenciais (clientId/secret) chegam via `additionalData`/
 * `options`/`credentials` quando o broker as fornece; se ausentes, caem no env
 * (single-client legado / seed). Não guarda nem renova estado — quem orquedstra
 * é o MarketplaceTokenBrokerService.
 */
@Injectable()
export class MercadoLivreAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(MercadoLivreAuthAdapter.name);
  private baseUrl = 'https://api.mercadolibre.com';
  public readonly name = 'Mercado Livre';
  public readonly tag = 'mercadolivre';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly tokenManager: TokenManagerService,
  ) {}

  onModuleInit() {
    this.registry.registerAuthAdapter(this);
  }

  // ── Helpers de consumo de token (usados pelos sub-adapters ML) ─────────────
  // Resolvem token via TokenManager (oauth2 → broker), sem depender do
  // MarketplaceAuthService (evita ciclo).

  /** Access token válido (já renovado) do ML por nome do marketplace. */
  async getValidToken(marketplaceName: string, domain?: string): Promise<string> {
    const marketplace = await this.marketplaceRegistry.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);
    const resolved = await this.tokenManager.resolveToken(String(marketplace._id), domain);
    return resolved.accessToken;
  }

  /** userId do ML (additionalData) por nome do marketplace. */
  async getUserId(marketplaceName: string, domain?: string): Promise<string> {
    const marketplace = await this.marketplaceRegistry.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);
    const resolved = await this.tokenManager.resolveToken(String(marketplace._id), domain);
    const userId = resolved.additionalData?.userId;
    if (!userId) throw new Error(`userId não encontrado no token do marketplace "${marketplaceName}"`);
    return String(userId);
  }

  /** Força refresh e devolve o novo access token. */
  async forceRefreshAccessToken(marketplaceName: string, domain?: string): Promise<string> {
    const marketplace = await this.marketplaceRegistry.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);
    const resolved = await this.tokenManager.forceRefresh(String(marketplace._id), domain);
    return resolved.accessToken;
  }

  /** GET /users/me autenticado. */
  async me(marketplaceName: string, domain?: string): Promise<any> {
    const token = await this.getValidToken(marketplaceName, domain);
    const response = await axios.get(`${this.baseUrl}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  }

  /** clientId/secret das credenciais fornecidas → fallback ao env. */
  private resolveCreds(credentials?: AdapterAccountCredentials): { clientId: string; clientSecret: string } {
    const clientId = credentials?.clientId
      || process.env.MP_MERCADOLIVRE_CLIENTID
      || process.env.MERCADO_LIVRE_APP_ID
      || '';
    const clientSecret = credentials?.clientSecret
      || process.env.MP_MERCADOLIVRE_CLIENTSECRET
      || process.env.MERCADO_LIVRE_CLIENT_SECRET
      || (clientId ? process.env[`MERCADO_LIVRE_CLIENT_SECRET_${clientId}`] : undefined)
      || '';
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('Credenciais do Mercado Livre (App ID / Client Secret) não configuradas.');
    }
    return { clientId, clientSecret };
  }

  async generateAuthUrl(
    redirectUri?: string,
    options?: { state?: string; credentials?: AdapterAccountCredentials },
  ): Promise<{ authUrl: string }> {
    const { clientId } = this.resolveCreds(options?.credentials);
    const stateParam = options?.state ? `&state=${encodeURIComponent(options.state)}` : '';
    const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri ?? '')}&scope=offline_access%20read%20write${stateParam}`;
    return { authUrl };
  }

  async authenticate(code: string, additionalData?: any): Promise<any> {
    const { clientId, clientSecret } = this.resolveCreds(additionalData?.credentials);
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('code', code);
    params.append('redirect_uri', additionalData?.redirectUri ?? '');

    try {
      const response = await axios.post(`${this.baseUrl}/oauth/token`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      });
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        tokenType: response.data.token_type,
        additionalData: { scope: response.data.scope, userId: response.data.user_id, clientId },
        isActive: true,
      };
    } catch (error: any) {
      this.logger.error(`Falha na autenticação do Mercado Livre: ${error.message}`, error.response?.data);
      throw new InternalServerErrorException(error.response?.data ?? `Falha na autenticação do Mercado Livre: ${error.message}`);
    }
  }

  async refreshToken(token: any, credentials?: AdapterAccountCredentials): Promise<any> {
    const { clientId, clientSecret } = this.resolveCreds({
      clientId: credentials?.clientId ?? token?.additionalData?.clientId,
      clientSecret: credentials?.clientSecret ?? token?.additionalData?.clientSecret,
    });
    try {
      const response = await axios.post(`${this.baseUrl}/oauth/token`, {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
      }, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      });
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        tokenType: response.data.token_type,
        additionalData: { ...(token.additionalData ?? {}), scope: response.data.scope, userId: response.data.user_id, clientId },
        isActive: true,
      };
    } catch (error: any) {
      throw new Error(`Falha na renovação do token do Mercado Livre: ${error.message}`);
    }
  }
}

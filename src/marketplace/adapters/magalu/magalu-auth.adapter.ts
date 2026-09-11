import { Injectable, Logger, InternalServerErrorException, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { IMarketplaceAuthAdapter, AdapterAccountCredentials } from '../../interfaces/marketplace-auth-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';

/**
 * Adapter de auth do Magalu — OAuth 2.0 Authorization Code, SEM PKCE.
 *
 * Confirmado via doc oficial de sellers (não confundir com a doc do Magalu
 * Cloud/IAM de infra, que é outro produto e usa PKCE): troca de code é
 * Content-Type application/json; refresh é application/x-www-form-urlencoded.
 * Isso é intencional e assimétrico — não "corrigir" para uniformizar.
 *
 * `choose_tenants=true` é fixo (não configurável): sem ele o consentimento
 * vale só para a pessoa física, não para a loja/organização do seller.
 */
@Injectable()
export class MagaluAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(MagaluAuthAdapter.name);
  private readonly authUrl = 'https://id.magalu.com/login';
  private readonly tokenUrl = 'https://id.magalu.com/oauth/token';
  public readonly name = 'Magalu';
  public readonly tag = 'magalu';

  constructor(private readonly registry: MarketplaceAdapterRegistry) {}

  onModuleInit() {
    this.registry.registerAuthAdapter(this);
  }

  /** clientId/secret das credenciais fornecidas pelo broker → fallback ao env (seed/dev). */
  private resolveCreds(credentials?: AdapterAccountCredentials): { clientId: string; clientSecret: string } {
    const clientId = credentials?.clientId || process.env.MP_MAGALU_CLIENTID || '';
    const clientSecret = credentials?.clientSecret || process.env.MP_MAGALU_CLIENTSECRET || '';
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('Credenciais do Magalu (client_id / client_secret) não configuradas.');
    }
    return { clientId, clientSecret };
  }

  async generateAuthUrl(
    redirectUri?: string,
    options?: { state?: string; credentials?: AdapterAccountCredentials },
  ): Promise<{ authUrl: string }> {
    const { clientId } = this.resolveCreds(options?.credentials);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri ?? '',
      response_type: 'code',
      choose_tenants: 'true',
    });
    // scope é omitido de propósito: os --scopes-default do client já cobrem
    // o consentimento necessário; o seller vê exatamente os defaults.
    if (options?.state) params.set('state', options.state);
    return { authUrl: `${this.authUrl}?${params.toString()}` };
  }

  async authenticate(code: string, additionalData?: any): Promise<any> {
    const { clientId, clientSecret } = this.resolveCreds(additionalData?.credentials);
    const redirectUri = additionalData?.redirectUri ?? '';
    try {
      const response = await axios.post(
        this.tokenUrl,
        {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
          grant_type: 'authorization_code',
        },
        { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } },
      );
      return this.toTokenData(response.data, clientId);
    } catch (error: any) {
      this.logger.error(`Falha na autenticação do Magalu: ${error.message}`, error.response?.data);
      throw new InternalServerErrorException(error.response?.data ?? `Falha na autenticação do Magalu: ${error.message}`);
    }
  }

  async refreshToken(token: any, credentials?: AdapterAccountCredentials): Promise<any> {
    const { clientId, clientSecret } = this.resolveCreds({
      clientId: credentials?.clientId ?? token?.additionalData?.clientId,
      clientSecret: credentials?.clientSecret ?? token?.additionalData?.clientSecret,
    });
    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
      });
      const response = await axios.post(this.tokenUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      });
      return this.toTokenData(response.data, clientId, token.additionalData);
    } catch (error: any) {
      const apiErr = error.response?.data;
      const detail = apiErr
        ? `${apiErr.error ?? ''}: ${apiErr.error_description ?? apiErr.message ?? ''}`.trim()
        : error.message;
      this.logger.error(`Falha na renovação do token do Magalu (clientId=${clientId}): ${detail}`, apiErr);
      throw new Error(`Falha na renovação do token do Magalu: ${detail}`);
    }
  }

  private toTokenData(data: any, clientId: string, previousAdditionalData?: Record<string, any>) {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      tokenType: data.token_type,
      additionalData: { ...(previousAdditionalData ?? {}), scope: data.scope, clientId },
      isActive: true,
    };
  }
}

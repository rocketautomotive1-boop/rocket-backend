import { Injectable, Logger, HttpException, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { createHmac } from 'crypto';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { TokenManagerService } from '../../auth/services/token-manager.service';
import { MarketplaceCredentialsService } from '../../credentials/marketplace-credentials.service';
import { getTikTokShopBaseUrl, buildHeaders } from './tiktok-shop-utils';

@Injectable()
export class TikTokShopAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(TikTokShopAuthAdapter.name);
  private baseUrl = getTikTokShopBaseUrl();
  readonly name = 'TikTok Shop';
  readonly tag = 'tiktokshop';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly tokenManager: TokenManagerService,
    private readonly credentials: MarketplaceCredentialsService,
  ) {}

  onModuleInit() {
    this.registry.registerAuthAdapter(this);
  }

  /** appKey/appSecret via CredentialsService (DB cifrado → env fallback). */
  private async creds(): Promise<{ appKey: string; appSecret: string }> {
    const appKey = await this.credentials.getRequired('tiktokshop', 'appKey');
    const appSecret = await this.credentials.getRequired('tiktokshop', 'appSecret');
    return { appKey, appSecret };
  }

  /**
   * Query params TikTok assinados resolvendo appKey/appSecret via
   * CredentialsService. Mesma fórmula do tiktok-shop-utils (HMAC wrapped),
   * mas sem ler env direto.
   */
  private signedParams(appKey: string, appSecret: string, path: string, timestamp: number, body?: string): Record<string, any> {
    const base: Record<string, any> = { app_key: appKey, timestamp };
    const sorted = Object.keys(base).sort().map((k) => `${k}${base[k]}`).join('');
    const content = `${path}${sorted}${body || ''}`;
    const sign = createHmac('sha256', appSecret).update(`${appSecret}${content}${appSecret}`).digest('hex');
    return { ...base, sign };
  }

  async authenticate(code: string, additionalData?: any): Promise<any> {
    if (!code) {
      this.logger.error('Parâmetros inválidos para autenticação: code é obrigatório');
      throw new Error('Parâmetros inválidos: informe o authorization code');
    }

    try {
      const { appKey, appSecret } = await this.creds();
      this.logger.log(`Autenticando no TikTok Shop com app_key: ${appKey}`);

      const path = '/api/v2/token/get';
      const timestamp = Math.floor(Date.now() / 1000);
      const queryParams = this.signedParams(appKey, appSecret, path, timestamp);

      const body = {
        app_key: appKey,
        app_secret: appSecret,
        auth_code: code,
        grant_type: 'authorized_code',
      };

      const response = await axios.post(`${this.baseUrl}${path}`, body, {
        headers: buildHeaders(),
        params: queryParams,
      });

      const data = response.data?.data;
      if (!data?.access_token) {
        throw new Error(`Resposta inválida do TikTok Shop: ${JSON.stringify(response.data)}`);
      }

      this.logger.log('Autenticação no TikTok Shop realizada com sucesso');

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + (data.access_token_expire_in || 0) * 1000),
        tokenType: 'Bearer',
        additionalData: {
          shopId: data.open_id,
          shopCipher: data.seller_base_region ? `${data.seller_base_region}` : '',
          sellerName: data.seller_name || '',
          refreshTokenExpiresAt: new Date(Date.now() + (data.refresh_token_expire_in || 0) * 1000),
        },
        isActive: true,
      };
    } catch (error: any) {
      this.logger.error(`Erro na autenticação do TikTok Shop: ${error.message}`, error.stack);
      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status);
      }
      throw new InternalServerErrorException(`Falha na autenticação do TikTok Shop: ${error.message}`);
    }
  }

  async getValidToken(marketplaceName: string): Promise<any> {
    const marketplace = await this.marketplaceRegistry.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace ${marketplaceName} não encontrado`);
    return await this.tokenManager.resolveToken(String(marketplace._id));
  }

  async refreshToken(token: any): Promise<any> {
    this.logger.log('Renovando token do TikTok Shop');

    try {
      const { appKey, appSecret } = await this.creds();
      const path = '/api/v2/token/refresh';
      const timestamp = Math.floor(Date.now() / 1000);
      const queryParams = this.signedParams(appKey, appSecret, path, timestamp);

      const body = {
        app_key: appKey,
        app_secret: appSecret,
        refresh_token: token.refreshToken,
        grant_type: 'refresh_token',
      };

      const response = await axios.post(`${this.baseUrl}${path}`, body, {
        headers: buildHeaders(),
        params: queryParams,
      });

      const data = response.data?.data;
      if (!data?.access_token) {
        throw new Error(`Resposta inválida ao renovar token: ${JSON.stringify(response.data)}`);
      }

      this.logger.debug('Token do TikTok Shop renovado com sucesso');

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + (data.access_token_expire_in || 0) * 1000),
        tokenType: 'Bearer',
        additionalData: {
          ...token.additionalData,
          refreshTokenExpiresAt: new Date(Date.now() + (data.refresh_token_expire_in || 0) * 1000),
        },
        isActive: true,
      };
    } catch (error: any) {
      this.logger.error(`Erro na renovação do token do TikTok Shop: ${error.message}`);

      if (error?.response?.status === 403 || error?.response?.status === 401) {
        const errorMsg = error?.response?.data?.message || '';
        if (errorMsg.includes('refresh_token') || errorMsg.includes('expired')) {
          this.logger.error('TikTok Shop: Refresh token expirado! Re-autorização necessária.');
          const authUrlObj = await this.generateAuthUrl();
          throw new HttpException(
            {
              message: 'TikTok Shop refresh token expirado. Re-autorização necessária.',
              error: 'TIKTOK_SHOP_REAUTH_REQUIRED',
              authUrl: authUrlObj.authUrl,
            },
            403,
          );
        }
      }

      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status);
      }
      throw new HttpException({ message: `Falha na renovação do token do TikTok Shop: ${error.message}` }, 500);
    }
  }

  async generateAuthUrl(_redirectUri?: string): Promise<{ authUrl: string }> {
    const { appKey } = await this.creds();
    const qs = new URLSearchParams({ app_key: appKey, state: `tiktokshop_${Date.now()}` });
    return { authUrl: `https://services.tiktokshop.com/open/authorize?${qs.toString()}` };
  }
}

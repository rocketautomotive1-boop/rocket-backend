import { Injectable, Logger, HttpException, Inject, forwardRef, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { MarketplaceAuthService } from '../../auth/services/marketplace-auth.service';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';
import {
  getTikTokShopBaseUrl,
  getAppKey,
  getAppSecret,
  buildHeaders,
  buildAuthUrl,
  buildSignedParams,
} from './tiktok-shop-utils';

@Injectable()
export class TikTokShopAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(TikTokShopAuthAdapter.name);
  private baseUrl = getTikTokShopBaseUrl();
  readonly name = 'TikTok Shop';
  readonly tag = 'tiktokshop';

  constructor(
    @Inject(forwardRef(() => MarketplaceAuthService))
    private marketplaceAuthService: MarketplaceAuthService,
  ) {}

  onModuleInit() {
    this.marketplaceAuthService.registerAdapter(this);
  }

  async authenticate(code: string, additionalData?: any): Promise<any> {
    if (!code) {
      this.logger.error('Parâmetros inválidos para autenticação: code é obrigatório');
      throw new Error('Parâmetros inválidos: informe o authorization code');
    }

    this.logger.log(`Autenticando no TikTok Shop com app_key: ${getAppKey()}`);

    try {
      const path = '/api/v2/token/get';
      const timestamp = Math.floor(Date.now() / 1000);

      const queryParams = buildSignedParams(path, timestamp);

      const body = {
        app_key: getAppKey(),
        app_secret: getAppSecret(),
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
          appKey: getAppKey(),
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
    const marketplace = await this.marketplaceAuthService.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace ${marketplaceName} não encontrado`);
    return await this.marketplaceAuthService.ensureValidToken(marketplace._id as any);
  }

  async refreshToken(token: any): Promise<any> {
    this.logger.log('Renovando token do TikTok Shop');

    try {
      const path = '/api/v2/token/refresh';
      const timestamp = Math.floor(Date.now() / 1000);

      const queryParams = buildSignedParams(path, timestamp);

      const body = {
        app_key: getAppKey(),
        app_secret: getAppSecret(),
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

  async generateAuthUrl(redirectUri?: string): Promise<{ authUrl: string }> {
    const defaultRedirect = process.env.TIKTOK_SHOP_REDIRECT_URL || `${process.env.API_BASE_URL}/auth/tiktok-shop/callback`;
    const url = buildAuthUrl(redirectUri || defaultRedirect);
    return { authUrl: url };
  }
}

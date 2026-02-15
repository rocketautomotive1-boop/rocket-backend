import { Injectable, Logger, HttpException, Inject, forwardRef, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { getShopeeBaseUrl, buildSignedParams, getPartnerId, buildHeaders, buildAuthUrl, getSignatureBaseString, generateSignature, getShopeeHost } from './shopee-utils'
import { MarketplaceAuthService } from '../../auth/services/marketplace-auth.service';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';

@Injectable()
export class ShopeeAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(ShopeeAuthAdapter.name);
  private baseUrl = getShopeeBaseUrl();
  readonly name = 'Shopee';
  readonly tag = 'shopee';

  constructor(
    @Inject(forwardRef(() => MarketplaceAuthService))
    private marketplaceAuthService: MarketplaceAuthService,
  ) { }

  onModuleInit() {
    this.marketplaceAuthService.registerAdapter(this);
  }

  async authenticate(code: string, additionalData?: any): Promise<any> {
    // Prefer passed shopId, fallback to env
    const shopId = additionalData?.shopId || process.env.SHOPEE_SHOP_ID;

    if (!code || !shopId) {
      this.logger.error('Parâmetros inválidos para autenticação: code e shopId são obrigatórios');
      throw new Error('Parâmetros inválidos: informe code e shopId (ou configure SHOPEE_SHOP_ID)');
    }

    // ... rest of logic
    this.logger.log(`Autenticando na Shopee com partner_id: ${getPartnerId()} host: ${getShopeeHost()}`);

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/auth/token/get';
      const params = buildSignedParams(path, timestamp)
      if (process.env.SHOPEE_DEBUG === 'true') {
        const base = getSignatureBaseString(path, timestamp)
        const sign = generateSignature(path, timestamp)
        this.logger.log(`Shopee sign debug (auth token): path=${path} ts=${timestamp} base_len=${base.length} sign_len=${sign.length}`)
      }

      // Simulação da chamada de autenticação
      const response = await axios.post(`${this.baseUrl}${path}`, {
        code: code,
        shop_id: parseInt(shopId),
        partner_id: parseInt(getPartnerId()),
      }, {
        headers: buildHeaders(),
        params,
      });

      this.logger.log('Autenticação na Shopee realizada com sucesso');

      // Usando unknown para evitar erro de tipagem
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expire_in * 1000),
        tokenType: 'Bearer',
        additionalData: {
          shopId: shopId,
          partnerId: getPartnerId(),
          partnerSecret: process.env.SHOPEE_PARTNER_KEY,
          merchantId: response.data.merchant_id,
          shopName: response.data.shop_name,
        },
        isActive: true,
      };
    } catch (error: any) {
      this.logger.error(`Erro na autenticação da Shopee: ${error.message}`, error.stack);
      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status)
      }
      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status)
      }
      throw new InternalServerErrorException(`Falha na autenticação da Shopee: ${error.message}`);
    }
  }

  async getValidToken(marketplaceName: string): Promise<any> {
    const marketplace = await this.marketplaceAuthService.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace ${marketplaceName} não encontrado`);

    // In Shopee, the "token" in DB is usually the full object with accessToken and additionalData
    return await this.marketplaceAuthService.ensureValidToken(marketplace._id as any);
  }

  async refreshToken(token: any): Promise<any> {
    this.logger.log(`Renovando token da Shopee`);

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/auth/access_token/get';
      const params = buildSignedParams(path, timestamp)

      const shopIdToUse = parseInt(String(token.additionalData.shopId));
      const partnerIdToUse = parseInt(getPartnerId());

      this.logger.log(`[ShopeeAuth] Refreshing with shop_id=${shopIdToUse}, partner_id=${partnerIdToUse}`);

      const response = await axios.post(`${this.baseUrl}${path}`, {
        refresh_token: token.refreshToken,
        shop_id: shopIdToUse,
        partner_id: partnerIdToUse,
      }, {
        headers: buildHeaders(),
        params,
      });

      this.logger.debug(`Response da renovação Shopee: ${JSON.stringify(response.data)}`);

      const newTokenData = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expire_in * 1000),
        tokenType: 'Bearer',
        additionalData: {
          ...token.additionalData,
          shopId: shopIdToUse, // Explicitly preserve
          partnerId: partnerIdToUse, // Explicitly preserve
        },
        isActive: true,
      };

      this.logger.debug(`Novo token gerado no adapter`);

      return newTokenData;
    } catch (error: any) {
      this.logger.error(`Erro na renovação do token da Shopee: ${error.message}`);

      // Check if it's a 403 error indicating expired refresh_token
      if (error?.response?.status === 403) {
        const errorMsg = error?.response?.data?.message || error?.response?.data?.error || '';
        if (errorMsg.includes('refresh token') || errorMsg.includes('refresh_token')) {
          this.logger.error(`❌ SHOPEE: Refresh token expirado! É necessário re-autorizar a aplicação no painel da Shopee.`);
          const authUrlObj = await this.generateAuthUrl(process.env.SHOPEE_REDIRECT_URL || 'http://localhost:3000/auth/shopee/callback');
          this.logger.error(`Acesse: ${authUrlObj.authUrl}`);
          throw new HttpException({
            message: 'Shopee refresh token expirado. Re-autorização necessária.',
            error: 'SHOPEE_REAUTH_REQUIRED',
            authUrl: authUrlObj.authUrl
          }, 403);
        }
      }

      if (error?.response?.status) {
        throw new HttpException(error.response.data ?? { message: error.message }, error.response.status)
      }
      throw new HttpException({ message: `Falha na renovação do token da Shopee: ${error.message}` }, 500)
    }
  }

  async generateAuthUrl(redirectUri?: string): Promise<{ authUrl: string }> {
    const defaultRedirect = process.env.SHOPEE_REDIRECT_URL || `${process.env.API_BASE_URL}/auth/shopee/callback`;
    const url = buildAuthUrl(redirectUri || defaultRedirect);
    return { authUrl: url };
  }
}

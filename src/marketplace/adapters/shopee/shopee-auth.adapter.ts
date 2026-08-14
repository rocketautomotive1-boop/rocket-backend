import { Injectable, Logger, HttpException, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { getShopeeBaseUrl, buildHeaders, getShopeeHost } from './shopee-utils'
import { ShopeeSignerService } from './shopee-signer.service'
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { TokenManagerService } from '../../auth/services/token-manager.service';

@Injectable()
export class ShopeeAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(ShopeeAuthAdapter.name);
  private baseUrl = getShopeeBaseUrl();
  readonly name = 'Shopee';
  readonly tag = 'shopee';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly tokenManager: TokenManagerService,
    private readonly signer: ShopeeSignerService,
  ) { }

  onModuleInit() {
    this.registry.registerAuthAdapter(this);
  }

  /**
   * Params Shopee assinados (sem token) via ShopeeSignerService — fonte única de
   * assinatura Shopee (partnerId/partnerKey resolvidos do DB cifrado → env fallback).
   */
  private async signedParams(path: string, timestamp: number): Promise<{ partnerId: string; params: Record<string, any> }> {
    const partnerId = await this.signer.getPartnerId();
    const params = await this.signer.buildSignedParams(path, timestamp);
    return { partnerId, params };
  }

  async authenticate(code: string, additionalData?: any): Promise<any> {
    // Prefer passed shopId, fallback to env
    const shopId = additionalData?.shopId || process.env.SHOPEE_SHOP_ID;

    if (!code || !shopId) {
      this.logger.error('Parâmetros inválidos para autenticação: code e shopId são obrigatórios');
      throw new Error('Parâmetros inválidos: informe code e shopId (ou configure SHOPEE_SHOP_ID)');
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/auth/token/get';
      // Credenciais (partnerId/partnerKey) resolvidas via CredentialsService
      // (marketplaces.credentials cifrado → env fallback) — sem ler env direto.
      const { partnerId, params } = await this.signedParams(path, timestamp);
      this.logger.log(`Autenticando na Shopee com partner_id: ${partnerId} host: ${getShopeeHost()}`);

      const response = await axios.post(`${this.baseUrl}${path}`, {
        code: code,
        shop_id: parseInt(shopId),
        partner_id: parseInt(partnerId),
      }, {
        headers: buildHeaders(),
        params,
      });

      this.logger.log('Autenticação na Shopee realizada com sucesso');

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expire_in * 1000),
        tokenType: 'Bearer',
        additionalData: {
          shopId: shopId,
          partnerId,
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
    const marketplace = await this.marketplaceRegistry.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace ${marketplaceName} não encontrado`);
    // Token completo (accessToken + additionalData) resolvido via broker (accounts[]).
    return await this.tokenManager.resolveToken(String(marketplace._id));
  }

  async refreshToken(token: any): Promise<any> {
    this.logger.log(`Renovando token da Shopee`);

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/auth/access_token/get';
      const { partnerId, params } = await this.signedParams(path, timestamp);

      const shopIdToUse = parseInt(String(token.additionalData.shopId));
      const partnerIdToUse = parseInt(partnerId);

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
    const redirect = redirectUri || defaultRedirect;
    const path = '/api/v2/shop/auth_partner';
    const timestamp = Math.floor(Date.now() / 1000);
    // partnerId/partnerKey via CredentialsService (DB cifrado → env fallback).
    const { partnerId, params } = await this.signedParams(path, timestamp);
    const qs = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      sign: String(params.sign),
      redirect,
    });
    return { authUrl: `${getShopeeHost()}${path}?${qs.toString()}` };
  }
}

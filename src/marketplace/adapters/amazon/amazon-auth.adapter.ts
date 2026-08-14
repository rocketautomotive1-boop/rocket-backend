import { Injectable, Logger, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import * as aws4 from 'aws4';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import { ResolvedToken } from '../../auth/services/token-manager.service';
import { TokenManagerService } from '../../auth/services/token-manager.service';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';

@Injectable()
export class AmazonAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(AmazonAuthAdapter.name);
  readonly name = 'Amazon';
  readonly tag = 'amazon';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly tokenManager: TokenManagerService,
  ) { }

  onModuleInit() {
    this.registry.registerAuthAdapter(this);
  }

  async getMarketplaceByName(name: string): Promise<MarketplaceDocument> {
    return this.marketplaceRegistry.findByName(name);
  }

  async getValidToken(marketplaceName: string): Promise<ResolvedToken> {
    const marketplace = await this.marketplaceRegistry.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace ${marketplaceName} não encontrado`);
    return this.tokenManager.resolveToken(String(marketplace._id));
  }

  async authenticate(code: string, additionalData?: any): Promise<MarketplaceToken> {
    const clientId = process.env.AMAZON_APP_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Credenciais da Amazon (AMAZON_APP_ID, AMAZON_CLIENT_SECRET) não configuradas.');
    }

    try {
      this.logger.log(`Trocando authorization code por token LWA... ClientID: ${clientId.substring(0, 5)}...`);
      // Amazon LWA exige que o redirect_uri seja idêntico ao usado na autorização
      const redirectUri = additionalData?.redirectUri;
      if (!redirectUri) {
        throw new Error('redirect_uri é obrigatório para troca de código Amazon LWA. Passe via authData.redirectUri.');
      }

      const response = await axios.post('https://api.amazon.com/auth/o2/token', {
        grant_type: 'authorization_code',
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      });

      this.logger.log(`Token LWA obtido com sucesso. Expires in: ${response.data.expires_in}`);

      const { access_token, refresh_token, expires_in, token_type } = response.data;

      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: new Date(Date.now() + (expires_in * 1000)),
        tokenType: token_type,
        isActive: true,
        additionalData: {}
      } as MarketplaceToken;

    } catch (error) {
      this.logger.error(`Erro ao autenticar inicial Amazon: ${error.message}`, error.response?.data);
      throw new InternalServerErrorException(`Falha na autenticação da Amazon: ${error.message}`);
    }
  }

  async createRestrictedDataToken(accessToken: string, restrictedResources: { method: string, path: string, dataElements?: string[] }[]): Promise<string> {
    const region = process.env.AMAZON_AWS_REGION || 'us-east-1';
    const endpoint = process.env.AMAZON_SPAPI_ENDPOINT || 'https://sellingpartnerapi-na.amazon.com';
    const accessKeyId = process.env.AMAZON_AWS_ACCESS_KEY;
    const secretAccessKey = process.env.AMAZON_AWS_SECRET_KEY;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('Credenciais AWS não configuradas para gerar RDT');
    }

    const url = new URL(endpoint);
    const path = '/tokens/2021-03-01/restrictedDataToken';

    // targetApplication is this app's own application_id registered in SP-API Developer Console.
    // Falls back to AMAZON_APP_ID env (the LWA client ID, which doubles as the app ID).
    const targetAppId = process.env.AMAZON_SP_APP_ID || process.env.AMAZON_APP_ID;

    const body: Record<string, any> = { restrictedResources };
    if (targetAppId) body.targetApplication = targetAppId;

    const request = {
      host: url.host,
      path,
      service: 'execute-api',
      region,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-amz-access-token': accessToken,
      } as Record<string, string>,
      body: JSON.stringify(body)
    };

    aws4.sign(request as any, { accessKeyId, secretAccessKey });

    try {
      this.logger.log(`Solicitando RDT para ${restrictedResources.length} recursos...`);
      const response = await axios.post(`${endpoint}${path}`, body, { headers: request.headers });
      const requestId = response.headers?.['x-amzn-requestid'] || 'N/A';
      this.logger.log(`RDT criado com sucesso — x-amzn-RequestId: ${requestId}`);
      return response.data.restrictedDataToken;
    } catch (error) {
      const requestId = error.response?.headers?.['x-amzn-requestid'] || 'N/A';
      this.logger.error(`Erro ao criar RDT — x-amzn-RequestId: ${requestId}`, error.response?.data);
      throw error;
    }
  }

  async refreshToken(token: any): Promise<MarketplaceToken> {
    const marketplaceId = token.marketplaceId || 'Unknown';
    this.logger.log(`Renovando token da Amazon para marketplace ID ${marketplaceId}`);

    const clientId = process.env.AMAZON_APP_ID;
    const clientSecret = process.env.AMAZON_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Credenciais da Amazon (AMAZON_APP_ID, AMAZON_CLIENT_SECRET) não configuradas.');
    }

    try {
      this.logger.log(`Solicitando novo token LWA... ClientID: ${clientId.substring(0, 5)}...`);
      const response = await axios.post('https://api.amazon.com/auth/o2/token', {
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });

      this.logger.log(`Token LWA renovado com sucesso. Expires in: ${response.data.expires_in}`);

      const { access_token, refresh_token, expires_in } = response.data;

      // Amazon retorna refresh_token novo? Às vezes sim, às vezes não (mantém o mesmo).
      // Se vier novo, atualizamos.

      return {
        ...token,
        accessToken: access_token,
        refreshToken: refresh_token || token.refreshToken,
        expiresAt: new Date(Date.now() + (expires_in * 1000)),
      } as MarketplaceToken;

    } catch (error) {
      this.logger.error(`Erro ao renovar token Amazon: ${error.message}`, error.response?.data);
      throw error;
    }
  }

  async generateAuthUrl(redirectUri?: string): Promise<{ authUrl: string }> {
    const appId = process.env.AMAZON_APP_ID;
    if (!appId) throw new Error('AMAZON_APP_ID não configurado');

    // Garante que o path /auth/amazon/callback está presente — o caller pode passar só a base URL
    let callbackUri = redirectUri || 'https://rocket-integration.com';
    if (!callbackUri.endsWith('/auth/amazon/callback')) {
      callbackUri = callbackUri.replace(/\/$/, '') + '/auth/amazon/callback';
    }

    const url =
      `https://sellercentral.amazon.com/apps/authorize/consent` +
      `?application_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(callbackUri)}` +
      `&version=beta`;

    this.logger.log(`Amazon OAuth URL gerada. Callback: ${callbackUri}`);
    return { authUrl: url };
  }
}



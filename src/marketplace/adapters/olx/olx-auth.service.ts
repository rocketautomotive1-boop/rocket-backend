import { Injectable, Logger, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument } from '../../schemas/marketplace.schema';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MarketplaceRegistryService } from '../../services/marketplace-registry.service';
import { TokenManagerService } from '../../auth/services/token-manager.service';
import { MarketplaceTokenBrokerService } from '../../auth/services/marketplace-token-broker.service';
import { resolveRedirectUri } from '../shared/resolve-redirect-uri';

@Injectable()
export class OLXAuthService implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(OLXAuthService.name);
  private readonly baseUrl = 'https://auth.olx.com.br';
  private readonly tokenUrl = `${this.baseUrl}/oauth/token`;
  readonly name = 'OLX';
  readonly tag = 'olx';

  constructor(
    private readonly httpService: HttpService,
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly marketplaceRegistry: MarketplaceRegistryService,
    private readonly tokenManager: TokenManagerService,
    private readonly broker: MarketplaceTokenBrokerService,
    @InjectModel(MarketplaceModel.name)
    private marketplaceModel: Model<MarketplaceDocument>,
    private readonly configService: ConfigService,
  ) { }

  onModuleInit() {
    this.registry.registerAuthAdapter(this);
  }

  /**
   * Resolve a redirect_uri da OLX a partir de marketplaces.settings.redirectUri,
   * com fallback para a env OLX_REDIRECT_URI.
   */
  private async resolveOlxRedirectUri(): Promise<string> {
    const mkt = await this.marketplaceRegistry.findByTag(this.tag).catch(() => null);
    return resolveRedirectUri(mkt, this.configService.get('OLX_REDIRECT_URI'));
  }

  /**
   * Alias for generateAuthUrl to satisfy interface and controller usage
   */
  async generateAuthUrl(redirectUri?: string): Promise<{ authUrl: string }> {
    const finalRedirectUri = redirectUri || await this.resolveOlxRedirectUri();
    const clientId = this.configService.get('OLX_CLIENT_ID');

    const authUrl = `${this.baseUrl}/oauth`;
    const params = new URLSearchParams({
      scope: 'autoupload basic_user_info',
      state: '/profile',
      redirect_uri: finalRedirectUri,
      response_type: 'code',
      client_id: clientId
    });

    return {
      authUrl: `${authUrl}?${params.toString()}`
    };
  }

  // Alias authenticate(string) to standard authenticate(code, data)
  async authenticate(code: string, additionalData?: any): Promise<any> {
    // standard implementation calling internal specialized one or direct logic
    return this.authenticateWithCode(code, additionalData);
  }

  private async authenticateWithCode(code: string, additionalData?: any): Promise<any> {
    try {
      this.logger.log(`Iniciando autenticação OAuth com ${this.name}`);

      const clientId = this.configService.get('OLX_CLIENT_ID');
      const clientSecret = this.configService.get(`OLX_CLIENT_SECRET_${clientId}`);
      // Sourced from marketplaces.settings.redirectUri (fallback OLX_REDIRECT_URI env).
      // Must match exactly what's registered in the OLX app — this is the fixed
      // app-registered URI. Never use additionalData.redirectUri (which may carry a
      // dynamic ngrok/dev host).
      const redirectUri = await this.resolveOlxRedirectUri();

      if (!clientId || !clientSecret || !redirectUri) {
        throw new InternalServerErrorException('Credenciais da OLX não configuradas');
      }

      const tokenResponse = await this.requestToken({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      return {
        accessToken: tokenResponse.data.access_token,
        refreshToken: tokenResponse.data.refresh_token,
        expiresAt: this.resolveExpiresAt(tokenResponse.data.expires_in),
        tokenType: tokenResponse.data.token_type,
        additionalData: {
          clientId,
          scope: tokenResponse.data.scope,
          authMethod: 'authorization_code'
        }
      };
    } catch (error) {
      this.logger.error(`Erro na autenticação OAuth com ${this.name}:`, error);
      throw error;
    }
  }

  async refreshToken(token: any): Promise<any> {
    if (!token?.refreshToken) {
      throw new Error(`Refresh token ausente para ${this.name}. Reautenticação necessária.`);
    }

    // Adapting generic token to OLX specific refresh
    const clientId = token.additionalData?.clientId || this.configService.get('OLX_CLIENT_ID');
    const clientSecret = token.additionalData?.clientSecret
      || this.configService.get(`OLX_CLIENT_SECRET_${clientId}`)
      || this.configService.get('OLX_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        `Credenciais da ${this.name} não configuradas para renovação do token.`,
      );
    }

    return this.refreshTokenInternal(clientId, clientSecret, token.refreshToken);
  }

  /**
   * Obter token válido para OLX por nome do marketplace.
   * Usado internamente por OLXImportService e OLXHttpInterceptor.
   * Para uso externo, prefira MarketplaceAuthService.ensureValidToken(marketplaceId).
   */
  async getValidToken(marketplaceName: string): Promise<any> {
    const marketplace = await this.marketplaceRegistry.findByName(marketplaceName);
    if (!marketplace) {
      throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);
    }
    return this.tokenManager.resolveToken(String(marketplace._id));
  }

  /**
   * Realizar autenticação automática usando credenciais configuradas
   * @param marketplace - Marketplace para autenticar
   */
  async performAutomaticAuthentication(marketplace: any): Promise<any> {
    try {
      this.logger.log(`Iniciando autenticação automática para OLX`);

      const clientId = marketplace.appId;
      const clientSecret = this.configService.get(`OLX_CLIENT_SECRET_${clientId}`);

      if (!clientId || !clientSecret) {
        throw new Error(`Credenciais da OLX não configuradas. Client ID: ${clientId}`);
      }

      // Tentar client credentials flow diretamente
      try {
        this.logger.log(`Tentando client credentials flow diretamente...`);

        const directTokenResponse = await this.requestToken(
          {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'autoupload basic_user_info',
          },
          {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
          },
        );

        if (directTokenResponse.data.access_token) {
          this.logger.log(`Client credentials flow funcionou diretamente!`);

          const directToken = {
            accessToken: directTokenResponse.data.access_token,
            refreshToken: directTokenResponse.data.refresh_token || null,
            expiresAt: this.resolveExpiresAt(directTokenResponse.data.expires_in),
            tokenType: directTokenResponse.data.token_type || 'Bearer',
            additionalData: {
              clientId,
              clientSecret,
              scope: directTokenResponse.data.scope || 'autoupload basic_user_info',
              authMethod: 'client_credentials_direct'
            }
          };
          await this.broker.saveTokenForDomain(String(marketplace._id), undefined, directToken);
          return directToken;
        }
      } catch (directError) {
        this.logger.warn(`Client credentials flow direto falhou: ${directError.message}`);
        this.logger.log(`Tentando fluxo authorization code...`);
      }

      // Se client credentials não funcionou, tentar authorization code flow
      const authCode = await this.getAuthorizationCode(clientId, clientSecret);

      if (authCode === 'client_credentials_success') {
        throw new Error('Fluxo client credentials já foi processado');
      }

      // Trocar authorization code por access token
      const tokenResponse = await this.requestToken(
        {
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: (await this.resolveOlxRedirectUri()) || 'http://localhost:3000/oauth/callback',
          code: authCode,
        },
        {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache',
        },
      );

      const codeToken = {
        accessToken: tokenResponse.data.access_token,
        refreshToken: tokenResponse.data.refresh_token || null,
        expiresAt: this.resolveExpiresAt(tokenResponse.data.expires_in),
        tokenType: tokenResponse.data.token_type || 'Bearer',
        additionalData: {
          clientId,
          clientSecret,
          scope: tokenResponse.data.scope || 'autoupload basic_user_info',
          authMethod: 'authorization_code'
        }
      };
      await this.broker.saveTokenForDomain(String(marketplace._id), undefined, codeToken);
      return codeToken;
    } catch (error) {
      this.logger.error(`Erro na autenticação automática para OLX: ${error.message}`);
      throw new Error(`Falha na autenticação automática para OLX: ${error.message}`);
    }
  }

  /**
   * Obter authorization code usando client credentials
   */
  private async getAuthorizationCode(clientId: string, clientSecret: string): Promise<string> {
    try {
      this.logger.log(`Tentando obter authorization code para client ID: ${clientId}`);

      const authResponse = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/oauth/authorize`, {
          params: {
            scope: 'autoupload basic_user_info',
            state: '/profile',
            redirect_uri: (await this.resolveOlxRedirectUri()) || 'http://localhost:3000/oauth/callback',
            response_type: 'code',
            client_id: clientId
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          }
        })
      );

      this.logger.log(`Resposta do authorization code flow:`, authResponse.data);

      const code = authResponse.data.code || authResponse.data.authorization_code;
      if (!code) {
        throw new Error('Não foi possível obter authorization code da OLX');
      }

      return code;
    } catch (error) {
      this.logger.error(`Erro ao obter authorization code: ${error.message}`);
      if (error.response?.data) {
        this.logger.error(`Detalhes do erro:`, error.response.data);
      }

      if (error.response?.status === 403) {
        throw new Error(`Acesso bloqueado pela OLX (Cloudflare). Verifique credenciais.`);
      }

      throw new Error(`Falha ao obter authorization code: ${error.message}`);
    }
  }

  /**
   * Verificar status dos tokens da OLX
   */
  async checkTokenStatus(marketplaceName: string): Promise<any> {
    try {
      const marketplace = await this.marketplaceRegistry.findByName(marketplaceName);
      if (!marketplace) {
        throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);
      }

      // Token resolvido pela via única (accounts[]). Pode não existir.
      const activeToken = await this.tokenManager
        .resolveToken(String(marketplace._id))
        .catch(() => null);
      const now = new Date();

      if (!activeToken?.accessToken) {
        return {
          marketplace: marketplaceName,
          hasTokens: false,
          hasActiveToken: false,
          message: 'Nenhum token ativo encontrado para OLX. Sistema tentará autenticação automática.',
          action: 'auto_authenticate',
        };
      }

      const expiresAt = activeToken.expiresAt ? new Date(activeToken.expiresAt) : new Date();
      const isExpired = expiresAt < now;
      const expiresInMinutes = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60));

      return {
        marketplace: marketplaceName,
        hasTokens: true,
        hasActiveToken: true,
        isExpired,
        expiresInMinutes: isExpired ? 0 : expiresInMinutes,
        message: isExpired
          ? 'Token ativo expirado. Sistema tentará reautenticação automática.'
          : `Token válido por mais ${expiresInMinutes} minutos.`,
        action: isExpired ? 'auto_reauthenticate' : 'valid',
        token: {
          isActive: true,
          expiresAt: activeToken.expiresAt,
        }
      };
    } catch (error) {
      this.logger.error(`Erro ao verificar status dos tokens da OLX: ${error.message}`);
      throw error;
    }
  }

  // Helper for internal use if needed, preserving legacy signature
  private async refreshTokenInternal(clientId: string, clientSecret: string, refreshToken: string): Promise<any> {
    try {
      this.logger.log(`Renovando token de acesso com ${this.name}`);

      const tokenResponse = await this.requestToken({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      });

      this.logger.log(`Token renovado com sucesso para ${this.name}`);

      return {
        accessToken: tokenResponse.data.access_token,
        refreshToken: tokenResponse.data.refresh_token || refreshToken,
        expiresAt: this.resolveExpiresAt(tokenResponse.data.expires_in), // Keep undefined when provider omits expiration
        tokenType: tokenResponse.data.token_type,
        additionalData: { // Added to match expectation
          clientId,
          clientSecret,
        }
      };
    } catch (error) {
      this.logger.error(`Erro ao renovar token com ${this.name}: ${error.message}`, error.response?.data);
      throw new Error(`Falha ao renovar token com ${this.name}: ${error.message}`);
    }
  }

  private async requestToken(
    payload: Record<string, string>,
    extraHeaders?: Record<string, string>,
  ): Promise<any> {
    const formData = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    });

    return firstValueFrom(
      this.httpService.post(this.tokenUrl, formData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          ...extraHeaders,
        },
      }),
    );
  }

  private resolveExpiresAt(expiresIn: unknown): Date | undefined {
    const seconds = Number(expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return undefined;
    }

    return new Date(Date.now() + seconds * 1000);
  }
}

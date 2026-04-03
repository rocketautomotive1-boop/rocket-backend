import { Injectable, Logger, Inject, forwardRef, OnModuleInit, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceAuthService } from '../../auth/services/marketplace-auth.service';
import { MarketplaceModel, MarketplaceDocument } from '../../schemas/marketplace.schema';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';

@Injectable()
export class OLXAuthService implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(OLXAuthService.name);
  private readonly baseUrl = 'https://auth.olx.com.br';
  readonly name = 'OLX';
  readonly tag = 'olx';

  constructor(
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => MarketplaceAuthService))
    private readonly authService: MarketplaceAuthService,
    @InjectModel(MarketplaceModel.name)
    private marketplaceModel: Model<MarketplaceDocument>,
    private readonly configService: ConfigService,
  ) { }

  onModuleInit() {
    this.authService.registerAdapter(this);
  }

  /**
   * Alias for generateAuthUrl to satisfy interface and controller usage
   */
  async generateAuthUrl(redirectUri?: string): Promise<{ authUrl: string }> {
    const finalRedirectUri = redirectUri || this.configService.get('OLX_REDIRECT_URI');
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
      const redirectUri = additionalData?.redirectUri || this.configService.get('OLX_REDIRECT_URI');

      if (!clientId || !clientSecret || !redirectUri) {
        throw new InternalServerErrorException('Credenciais da OLX não configuradas');
      }

      const tokenResponse = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/oauth/token`, {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        }, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      return {
        accessToken: tokenResponse.data.access_token,
        refreshToken: tokenResponse.data.refresh_token,
        expiresAt: new Date(Date.now() + (tokenResponse.data.expires_in || 3600) * 1000),
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
    // Adapting generic token to OLX specific refresh
    const clientId = token.additionalData?.clientId || this.configService.get('OLX_CLIENT_ID');
    const clientSecret = this.configService.get(`OLX_CLIENT_SECRET_${clientId}`);
    return this.refreshTokenInternal(clientId, clientSecret, token.refreshToken);
  }

  /**
   * Obter token válido para OLX por nome do marketplace.
   * Usado internamente por OLXImportService e OLXHttpInterceptor.
   * Para uso externo, prefira MarketplaceAuthService.ensureValidToken(marketplaceId).
   */
  async getValidToken(marketplaceName: string): Promise<any> {
    const marketplace = await this.authService.findByName(marketplaceName);
    if (!marketplace) {
      throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);
    }
    return this.authService.ensureValidToken(marketplace._id);
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

        const directTokenResponse = await firstValueFrom(
          this.httpService.post(`${this.baseUrl}/oauth/token`, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'autoupload basic_user_info'
          }, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
              'Accept-Encoding': 'gzip, deflate, br',
              'Connection': 'keep-alive',
              'Cache-Control': 'no-cache'
            }
          })
        );

        if (directTokenResponse.data.access_token) {
          this.logger.log(`Client credentials flow funcionou diretamente!`);

          return this.authService.saveToken(marketplace._id, {
            accessToken: directTokenResponse.data.access_token,
            refreshToken: directTokenResponse.data.refresh_token || null,
            expiresAt: new Date(Date.now() + (directTokenResponse.data.expires_in || 3600) * 1000),
            tokenType: directTokenResponse.data.token_type || 'Bearer',
            additionalData: {
              clientId,
              clientSecret,
              scope: directTokenResponse.data.scope || 'autoupload basic_user_info',
              authMethod: 'client_credentials_direct'
            }
          });
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
      const tokenResponse = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/oauth/token`, {
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: this.configService.get('OLX_REDIRECT_URI') || 'http://localhost:3000/oauth/callback',
          code: authCode
        }, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
          }
        })
      );

      return this.authService.saveToken(marketplace._id, {
        accessToken: tokenResponse.data.access_token,
        refreshToken: tokenResponse.data.refresh_token || null,
        expiresAt: new Date(Date.now() + (tokenResponse.data.expires_in || 3600) * 1000),
        tokenType: tokenResponse.data.token_type || 'Bearer',
        additionalData: {
          clientId,
          clientSecret,
          scope: tokenResponse.data.scope || 'autoupload basic_user_info',
          authMethod: 'authorization_code'
        }
      });
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
            redirect_uri: this.configService.get('OLX_REDIRECT_URI') || 'http://localhost:3000/oauth/callback',
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
      const marketplace = await this.authService.findByName(marketplaceName);
      if (!marketplace) {
        throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);
      }

      // Buscar tokens no marketplace (embedded)
      const tokens = marketplace.tokens || [];

      if (tokens.length === 0) {
        return {
          marketplace: marketplaceName,
          hasTokens: false,
          message: 'Nenhum token encontrado para OLX. Sistema tentará autenticação automática.',
          action: 'auto_authenticate'
        };
      }

      const activeToken = tokens.find(token => token.isActive);
      const now = new Date();

      if (!activeToken) {
        return {
          marketplace: marketplaceName,
          hasTokens: true,
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
          isActive: activeToken.isActive,
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

      const tokenResponse = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/oauth/token`, {
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken
        }, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );

      this.logger.log(`Token renovado com sucesso para ${this.name}`);

      return {
        accessToken: tokenResponse.data.access_token,
        refreshToken: tokenResponse.data.refresh_token,
        expiresAt: new Date(Date.now() + (tokenResponse.data.expires_in || 3600) * 1000), // Adjusted logic
        tokenType: tokenResponse.data.token_type,
        additionalData: { // Added to match expectation
          clientId,
        }
      };
    } catch (error) {
      this.logger.error(`Erro ao renovar token com ${this.name}:`, error);
      throw new Error(`Falha ao renovar token com ${this.name}: ${error.message}`);
    }
  }
}

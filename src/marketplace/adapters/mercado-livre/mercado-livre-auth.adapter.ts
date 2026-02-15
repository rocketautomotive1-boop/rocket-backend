import { Inject, forwardRef, Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { MarketplaceAuthService } from '../../auth/services/marketplace-auth.service';


import { OnModuleInit } from '@nestjs/common';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';

@Injectable()
export class MercadoLivreAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(MercadoLivreAuthAdapter.name);
  private baseUrl = 'https://api.mercadolibre.com';
  public readonly name = 'Mercado Livre';
  public readonly tag = 'mercadolivre';

  constructor(
    @Inject(forwardRef(() => MarketplaceAuthService))
    private authService: MarketplaceAuthService,
  ) { }

  onModuleInit() {
    this.authService.registerAdapter(this);
  }

  /**
   * Autentica e retorna a estrutura de token (delegando para o auth service se possível,
   * mas aqui mantemos a lógica de "cliente HTTP" se necessário, ou usamos o service).
   * 
   * Na verdade, o MarketplaceAuthService já tem authenticateMercadoLivre.
   * Se este método for chamado externamente, podemos redirecionar ou manter a lógica pura de HTTP.
   * Para compatibilidade, mantemos a lógica HTTP aqui mas o correto seria o Service orquestrar.
   */
  async authenticate(code: string, additionalData: any): Promise<any> {
    try {
      const appId = process.env.MERCADO_LIVRE_APP_ID;
      const clientSecret = process.env.MERCADO_LIVRE_CLIENT_SECRET || process.env[`MERCADO_LIVRE_CLIENT_SECRET_${appId}`];

      if (!appId || !clientSecret) {
        this.logger.error(`Credenciais do Mercado Livre enviadas: AppID=${appId}, ClientSecret=${clientSecret ? '***' : 'MISSING'}`);
        throw new InternalServerErrorException('Credenciais do Mercado Livre (App ID ou Client Secret) não configuradas.');
      }

      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('client_id', appId);
      params.append('client_secret', clientSecret);
      params.append('code', code);
      params.append('redirect_uri', additionalData.redirectUri);

      const response = await axios.post(`${this.baseUrl}/oauth/token`, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        tokenType: response.data.token_type,
        additionalData: {
          scope: response.data.scope,
          userId: response.data.user_id,
          clientId: appId, // Store for refresh usage
          clientSecret: clientSecret, // Store for refresh usage if needed, though better from env
        },
        isActive: true,
      };
    } catch (error) {
      this.logger.error(`Falha na autenticação do Mercado Livre: ${error.message}`, error.response?.data);
      if (error.response) {
        throw new InternalServerErrorException(error.response.data);
      }
      throw new InternalServerErrorException(`Falha na autenticação do Mercado Livre: ${error.message}`);
    }
  }

  async refreshToken(token: any): Promise<any> {
    try {
      // Prefer stored credentials, fallback to env (dynamic or static)
      const clientId = token.additionalData.clientId || process.env.MERCADO_LIVRE_APP_ID;
      const clientSecret = token.additionalData.clientSecret ||
        process.env.MERCADO_LIVRE_CLIENT_SECRET ||
        process.env[`MERCADO_LIVRE_CLIENT_SECRET_${clientId}`];

      if (!clientId || !clientSecret) {
        throw new InternalServerErrorException('Client ID ou Secret não encontrados para renovação de token.');
      }

      const response = await axios.post(`${this.baseUrl}/oauth/token`, {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: token.refreshToken,
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      });

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        tokenType: response.data.token_type,
        additionalData: {
          ...token.additionalData,
          scope: response.data.scope,
          userId: response.data.user_id,
        },
        isActive: true,
      };
    } catch (error) {
      throw new Error(`Falha na renovação do token do Mercado Livre: ${error.message}`);
    }
  }

  async me(marketplaceName: string): Promise<any> {
    const token = await this.getValidToken(marketplaceName);
    const response = await axios.get(`${this.baseUrl}/users/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.data;
  }

  async getValidToken(marketplaceName: string): Promise<string> {
    try {
      // Usa o AuthService para buscar o marketplace e garantir token válido
      const marketplace = await this.authService.findByName(marketplaceName);
      if (!marketplace) {
        throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);
      }

      const validToken = await this.authService.ensureValidToken(marketplace._id);
      return validToken.accessToken;
    } catch (error) {
      throw error;
    }
  }

  async forceRefreshAccessToken(marketplaceName: string): Promise<string> {
    const marketplace = await this.authService.findByName(marketplaceName);
    if (!marketplace) throw new Error(`Marketplace "${marketplaceName}" não encontrado.`);

    // Usa o método específico de refresh do AuthService
    const existingToken = await this.authService.getToken(marketplace._id);
    if (!existingToken) throw new Error(`Nenhum token encontrado para ${marketplaceName}`);
    const newToken = await this.authService.refreshToken(marketplace._id, existingToken);
    return newToken.accessToken;
  }

  async generateAuthUrl(redirectUri: string): Promise<{ authUrl: string }> {
    const appId = process.env.MERCADO_LIVRE_APP_ID;
    if (!appId) {
      this.logger.error('MERCADO_LIVRE_APP_ID não configurado nas variáveis de ambiente');
      throw new InternalServerErrorException('Configuração do Mercado Livre incompleta (App ID ausente)');
    }
    const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=offline_access%20read%20write`;
    return { authUrl };
  }
}


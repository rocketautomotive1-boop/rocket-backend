import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import axios from 'axios';

import { OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { MarketplaceAuthService } from '../../auth/services/marketplace-auth.service';
import { IMarketplaceAuthAdapter } from '../../interfaces/marketplace-auth-adapter.interface';

@Injectable()
export class YampiAuthAdapter implements IMarketplaceAuthAdapter, OnModuleInit {
  private readonly logger = new Logger(YampiAuthAdapter.name);
  private readonly apiUrl = 'https://api.dooki.com.br/v2';
  public readonly name = 'Yampi';
  public readonly tag = 'yampi';

  constructor(
    @Inject(forwardRef(() => MarketplaceAuthService))
    private authService: MarketplaceAuthService,
  ) { }

  onModuleInit() {
    this.authService.registerAdapter(this);
  }

  async generateAuthUrl(redirectUri?: string): Promise<{ authUrl: string }> {
    // Yampi uses API Token, no OAuth flow
    return { authUrl: '' };
  }

  async authenticate(credentials: any): Promise<MarketplaceToken> {
    try {
      const { clientId, clientSecret, merchantAlias } = credentials;

      if (!clientId || !clientSecret || !merchantAlias) {
        throw new Error('Credenciais incompletas para autenticação na Yampi');
      }

      // Para a Yampi, usamos autenticação via API Key
      // A API da Yampi usa autenticação via header Authorization
      const token: MarketplaceToken = {
        // id: null, // Removed as per Mongoose schema
        marketplaceId: credentials.marketplaceId,
        accessToken: clientSecret, // API Key da Yampi
        refreshToken: null,
        expiresAt: null, // API Key não expira
        tokenType: 'Bearer',
        additionalData: {
          merchantAlias: merchantAlias,
          clientId: clientId
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.logger.log('Autenticação na Yampi realizada com sucesso');
      return token;
    } catch (error) {
      this.logger.error(`Erro na autenticação da Yampi: ${error.message}`, error.stack);
      throw error;
    }
  }

  async refreshToken(token: MarketplaceToken): Promise<MarketplaceToken> {
    // A Yampi usa API Key que não expira, então não precisa de refresh
    this.logger.log('Token da Yampi não precisa de refresh (API Key)');
    return token;
  }

  async validateToken(token: MarketplaceToken): Promise<boolean> {
    try {
      const merchantAlias = token.additionalData?.merchantAlias;
      if (!merchantAlias) {
        return false;
      }

      // Testar a API fazendo uma requisição simples
      const response = await axios.get(
        `${this.apiUrl}/${merchantAlias}/catalog/products?limit=1`,
        {
          headers: {
            'Authorization': `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.status === 200;
    } catch (error) {
      this.logger.error(`Erro ao validar token da Yampi: ${error.message}`);
      return false;
    }
  }
} 
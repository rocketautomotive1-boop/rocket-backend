import { Injectable, Logger } from '@nestjs/common';
import { MarketplaceToken } from '../../schemas/marketplace-token.schema';
import axios from 'axios';

@Injectable()
export class ViaVarejoAuthAdapter {
  private readonly logger = new Logger(ViaVarejoAuthAdapter.name);
  private readonly apiUrl = 'https://api.grupocasasbahia.com.br';

  async authenticate(credentials: any): Promise<MarketplaceToken> {
    try {
      const { clientId, clientSecret, sellerId } = credentials;

      if (!clientId || !clientSecret || !sellerId) {
        throw new Error('Credenciais incompletas para autenticação na Via Varejo');
      }

      // Para a Via Varejo, usamos autenticação OAuth 2.0
      // Primeiro, obter o token de acesso
      const tokenResponse = await axios.post(
        `${this.apiUrl}/oauth/token`,
        {
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'marketplace'
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const token: MarketplaceToken = {
        // id: null, // Removed as per Mongoose schema
        marketplaceId: credentials.marketplaceId,
        accessToken: tokenResponse.data.access_token,
        refreshToken: tokenResponse.data.refresh_token,
        expiresAt: new Date(Date.now() + tokenResponse.data.expires_in * 1000),
        tokenType: tokenResponse.data.token_type || 'Bearer',
        additionalData: {
          sellerId: sellerId,
          clientId: clientId,
          tokenType: tokenResponse.data.token_type
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.logger.log('Autenticação na Via Varejo realizada com sucesso');
      return token;
    } catch (error) {
      this.logger.error(`Erro na autenticação da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async refreshToken(token: MarketplaceToken): Promise<MarketplaceToken> {
    try {
      const { clientId, clientSecret } = token.additionalData;

      if (!clientId || !clientSecret || !token.refreshToken) {
        throw new Error('Credenciais incompletas para refresh do token da Via Varejo');
      }

      const response = await axios.post(
        `${this.apiUrl}/oauth/token`,
        {
          grant_type: 'refresh_token',
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: token.refreshToken
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const updatedToken: MarketplaceToken = {
        ...token,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || token.refreshToken,
        expiresAt: new Date(Date.now() + response.data.expires_in * 1000),
        updatedAt: new Date()
      };

      this.logger.log('Token da Via Varejo atualizado com sucesso');
      return updatedToken;
    } catch (error) {
      this.logger.error(`Erro ao atualizar token da Via Varejo: ${error.message}`, error.stack);
      throw error;
    }
  }

  async validateToken(token: MarketplaceToken): Promise<boolean> {
    try {
      const sellerId = token.additionalData?.sellerId;
      if (!sellerId) {
        return false;
      }

      // Testar a API fazendo uma requisição simples
      const response = await axios.get(
        `${this.apiUrl}/marketplace/sellers/${sellerId}/products?limit=1`,
        {
          headers: {
            'Authorization': `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.status === 200;
    } catch (error) {
      this.logger.error(`Erro ao validar token da Via Varejo: ${error.message}`);
      return false;
    }
  }
} 
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OLXHighlightsService {
  private readonly logger = new Logger(OLXHighlightsService.name);
  private readonly baseUrl = 'https://apps.olx.com.br';
  private readonly name = 'OLX';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Consultar saldo da conta
   * @param accessToken - Token de acesso OAuth
   */
  async getBalance(accessToken: string): Promise<any> {
    try {
      this.logger.log(`Consultando saldo no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/balance`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Saldo consultado com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        balance: response.data.balance,
        currency: response.data.currency
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar saldo no ${this.name}:`, error);
      throw new Error(`Falha ao consultar saldo no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Aplicar destaque ao anúncio
   * @param accessToken - Token de acesso OAuth
   * @param adId - ID do anúncio
   * @param highlightType - Tipo de destaque
   */
  async applyHighlight(accessToken: string, adId: string, highlightType: string): Promise<any> {
    try {
      this.logger.log(`Aplicando destaque ${highlightType} ao anúncio ${adId} no ${this.name}`);

      const requestBody = {
        access_token: accessToken,
        highlight_type: highlightType
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/ads/${adId}/highlights`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Destaque aplicado com sucesso ao anúncio ${adId} no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        adId: adId,
        highlightId: response.data.highlight_id,
        highlightType: highlightType
      };
    } catch (error) {
      this.logger.error(`Erro ao aplicar destaque ao anúncio ${adId} no ${this.name}:`, error);
      throw new Error(`Falha ao aplicar destaque no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Remover destaque do anúncio
   * @param accessToken - Token de acesso OAuth
   * @param adId - ID do anúncio
   * @param highlightId - ID do destaque
   */
  async removeHighlight(accessToken: string, adId: string, highlightId: string): Promise<any> {
    try {
      this.logger.log(`Removendo destaque ${highlightId} do anúncio ${adId} no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.delete(`${this.baseUrl}/api/ads/${adId}/highlights/${highlightId}`, {
          data: requestBody,
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Destaque removido com sucesso do anúncio ${adId} no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        adId: adId,
        highlightId: highlightId,
        message: 'Destaque removido com sucesso'
      };
    } catch (error) {
      this.logger.error(`Erro ao remover destaque do anúncio ${adId} no ${this.name}:`, error);
      throw new Error(`Falha ao remover destaque no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Listar destaques do anúncio
   * @param accessToken - Token de acesso OAuth
   * @param adId - ID do anúncio
   */
  async getAdHighlights(accessToken: string, adId: string): Promise<any> {
    try {
      this.logger.log(`Consultando destaques do anúncio ${adId} no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/ads/${adId}/highlights`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Destaques consultados com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        adId: adId,
        highlights: response.data.highlights
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar destaques do anúncio ${adId} no ${this.name}:`, error);
      throw new Error(`Falha ao consultar destaques no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Consultar configurações de destaque
   * @param accessToken - Token de acesso OAuth
   */
  async getHighlightConfigurations(accessToken: string): Promise<any> {
    try {
      this.logger.log(`Consultando configurações de destaque no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/highlights/configurations`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Configurações de destaque consultadas com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        configurations: response.data.configurations
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar configurações de destaque no ${this.name}:`, error);
      throw new Error(`Falha ao consultar configurações de destaque no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Renovar anúncio
   * @param accessToken - Token de acesso OAuth
   * @param adId - ID do anúncio
   */
  async renewAd(accessToken: string, adId: string): Promise<any> {
    try {
      this.logger.log(`Renovando anúncio ${adId} no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/ads/${adId}/renew`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Anúncio ${adId} renovado com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        adId: adId,
        renewedAt: response.data.renewed_at,
        expiresAt: response.data.expires_at
      };
    } catch (error) {
      this.logger.error(`Erro ao renovar anúncio ${adId} no ${this.name}:`, error);
      throw new Error(`Falha ao renovar anúncio no ${this.name}: ${error.message}`);
    }
  }
} 
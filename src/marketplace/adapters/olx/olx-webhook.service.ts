import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OLXWebhookService {
  private readonly logger = new Logger(OLXWebhookService.name);
  private readonly baseUrl = 'https://apps.olx.com.br';
  private readonly name = 'OLX';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Configurar webhook
   * @param accessToken - Token de acesso OAuth
   * @param webhookUrl - URL do webhook
   * @param events - Eventos a serem monitorados
   */
  async configureWebhook(accessToken: string, webhookUrl: string, events: string[] = ['ad_status_changed']): Promise<any> {
    try {
      this.logger.log(`Configurando webhook no ${this.name}`);

      const requestBody = {
        access_token: accessToken,
        url: webhookUrl,
        events: events
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/webhooks`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Webhook configurado com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        webhookId: response.data.webhook_id,
        url: webhookUrl,
        events: events
      };
    } catch (error) {
      this.logger.error(`Erro ao configurar webhook no ${this.name}:`, error);
      throw new Error(`Falha ao configurar webhook no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Listar webhooks configurados
   * @param accessToken - Token de acesso OAuth
   */
  async listWebhooks(accessToken: string): Promise<any> {
    try {
      this.logger.log(`Listando webhooks no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/webhooks`, requestBody, {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Webhooks listados com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        webhooks: response.data.webhooks
      };
    } catch (error) {
      this.logger.error(`Erro ao listar webhooks no ${this.name}:`, error);
      throw new Error(`Falha ao listar webhooks no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Remover webhook
   * @param accessToken - Token de acesso OAuth
   * @param webhookId - ID do webhook
   */
  async removeWebhook(accessToken: string, webhookId: string): Promise<any> {
    try {
      this.logger.log(`Removendo webhook ${webhookId} no ${this.name}`);

      const requestBody = {
        access_token: accessToken
      };

      const response = await firstValueFrom(
        this.httpService.delete(`${this.baseUrl}/api/webhooks/${webhookId}`, {
          data: requestBody,
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Webhook ${webhookId} removido com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        webhookId: webhookId,
        message: 'Webhook removido com sucesso'
      };
    } catch (error) {
      this.logger.error(`Erro ao remover webhook ${webhookId} no ${this.name}:`, error);
      throw new Error(`Falha ao remover webhook no ${this.name}: ${error.message}`);
    }
  }

  /**
   * Processar notificação de webhook
   * @param payload - Payload da notificação
   */
  async processWebhookNotification(payload: any): Promise<any> {
    try {
      this.logger.log(`Processando notificação de webhook do ${this.name}`);

      // Validar assinatura do webhook (se necessário)
      if (!this.validateWebhookSignature(payload)) {
        throw new Error('Assinatura do webhook inválida');
      }

      // Processar diferentes tipos de eventos
      const eventType = payload.event_type;
      const eventData = payload.data;

      switch (eventType) {
        case 'ad_status_changed':
          await this.handleAdStatusChanged(eventData);
          break;
        case 'ad_created':
          await this.handleAdCreated(eventData);
          break;
        case 'ad_updated':
          await this.handleAdUpdated(eventData);
          break;
        case 'ad_deleted':
          await this.handleAdDeleted(eventData);
          break;
        default:
          this.logger.warn(`Evento não reconhecido: ${eventType}`);
      }

      this.logger.log(`Notificação de webhook processada com sucesso no ${this.name}`);
      
      return {
        marketplace: this.name,
        success: true,
        eventType: eventType,
        processed: true
      };
    } catch (error) {
      this.logger.error(`Erro ao processar notificação de webhook do ${this.name}:`, error);
      throw new Error(`Falha ao processar notificação de webhook do ${this.name}: ${error.message}`);
    }
  }

  /**
   * Validar assinatura do webhook
   * @param payload - Payload da notificação
   */
  private validateWebhookSignature(payload: any): boolean {
    // Implementar validação de assinatura se necessário
    // Por enquanto, retorna true
    return true;
  }

  /**
   * Manipular mudança de status do anúncio
   * @param eventData - Dados do evento
   */
  private async handleAdStatusChanged(eventData: any): Promise<void> {
    this.logger.log(`Status do anúncio ${eventData.ad_id} alterado para: ${eventData.status}`);
    // Implementar lógica específica para mudança de status
  }

  /**
   * Manipular criação de anúncio
   * @param eventData - Dados do evento
   */
  private async handleAdCreated(eventData: any): Promise<void> {
    this.logger.log(`Anúncio ${eventData.ad_id} criado`);
    // Implementar lógica específica para criação de anúncio
  }

  /**
   * Manipular atualização de anúncio
   * @param eventData - Dados do evento
   */
  private async handleAdUpdated(eventData: any): Promise<void> {
    this.logger.log(`Anúncio ${eventData.ad_id} atualizado`);
    // Implementar lógica específica para atualização de anúncio
  }

  /**
   * Manipular exclusão de anúncio
   * @param eventData - Dados do evento
   */
  private async handleAdDeleted(eventData: any): Promise<void> {
    this.logger.log(`Anúncio ${eventData.ad_id} excluído`);
    // Implementar lógica específica para exclusão de anúncio
  }
} 
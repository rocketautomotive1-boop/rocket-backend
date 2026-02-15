import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class ViaVarejoWebhookService {
  private readonly logger = new Logger(ViaVarejoWebhookService.name);

  constructor(
    @Inject('MARKETPLACE_SERVICE')
    private marketplaceClient: ClientProxy,
    private configService: ConfigService,
  ) {}

  /**
   * Processar webhook da Via Varejo (Casas Bahia, Ponto Frio)
   */
  async processWebhook(topic: string, payload: any, signature: string): Promise<any> {
    this.logger.log(`Processando webhook da Via Varejo: ${topic}`);
    
    // Verificar assinatura
    if (!this.verifySignature(payload, signature)) {
      this.logger.warn('Assinatura inválida para webhook da Via Varejo');
      return { success: false, message: 'Assinatura inválida' };
    }
    
    try {
      // Processar diferentes tipos de webhook
      let processedData = payload;
      
      switch (topic) {
        case 'order.created':
        case 'order.updated':
        case 'order.cancelled':
        case 'order.shipped':
        case 'order.delivered':
          processedData = this.processOrderWebhook(payload);
          break;
        case 'product.created':
        case 'product.updated':
        case 'product.deleted':
        case 'product.reviewed':
          processedData = this.processProductWebhook(payload);
          break;
        case 'customer.created':
        case 'customer.updated':
          processedData = this.processCustomerWebhook(payload);
          break;
        default:
          this.logger.log(`Tópico não processado: ${topic}`);
      }
      
      // Adicionar à fila para processamento assíncrono
      this.marketplaceClient.emit('webhook-viavarejo', {
        topic,
        payload: processedData,
        receivedAt: new Date(),
      });
      
      this.logger.log(`Webhook da Via Varejo adicionado à fila: ${topic}`);
      
      return { success: true, message: 'Notificação recebida com sucesso' };
    } catch (error) {
      this.logger.error(`Erro ao processar webhook da Via Varejo: ${error.message}`, error.stack);
      return { success: false, message: 'Erro ao processar notificação' };
    }
  }

  /**
   * Verificar assinatura da Via Varejo
   */
  private verifySignature(payload: any, signature: string): boolean {
    if (!signature) return false;
    
    try {
      const secret = this.configService.get('VIAVAREJO_WEBHOOK_SECRET');
      if (!secret) {
        this.logger.warn('Secret para verificação de assinatura da Via Varejo não configurado');
        return false;
      }
      
      const hmac = crypto.createHmac('sha256', secret);
      const calculatedSignature = hmac.update(JSON.stringify(payload)).digest('hex');
      
      return calculatedSignature === signature;
    } catch (error) {
      this.logger.error(`Erro ao verificar assinatura da Via Varejo: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Processar webhook de pedido
   */
  private processOrderWebhook(payload: any): any {
    return {
      id: payload.data?.id,
      order_number: payload.data?.order_number,
      status: payload.data?.status,
      total: payload.data?.total,
      customer: payload.data?.customer,
      items: payload.data?.items,
      shipping: payload.data?.shipping,
      payments: payload.data?.payments,
      tracking: payload.data?.tracking,
      created_at: payload.data?.created_at,
      updated_at: payload.data?.updated_at,
    };
  }

  /**
   * Processar webhook de produto
   */
  private processProductWebhook(payload: any): any {
    return {
      id: payload.data?.id,
      title: payload.data?.title,
      sku: payload.data?.sku,
      price: payload.data?.price,
      stock: payload.data?.stock,
      status: payload.data?.status,
      category_id: payload.data?.category_id,
      brand: payload.data?.brand,
      model: payload.data?.model,
      images: payload.data?.images,
      warranty: payload.data?.warranty,
      created_at: payload.data?.created_at,
      updated_at: payload.data?.updated_at,
    };
  }

  /**
   * Processar webhook de cliente
   */
  private processCustomerWebhook(payload: any): any {
    return {
      id: payload.data?.id,
      name: payload.data?.name,
      email: payload.data?.email,
      phone: payload.data?.phone,
      document: payload.data?.document,
      address: payload.data?.address,
      created_at: payload.data?.created_at,
      updated_at: payload.data?.updated_at,
    };
  }
}

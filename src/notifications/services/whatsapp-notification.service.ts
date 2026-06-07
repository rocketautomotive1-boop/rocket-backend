import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IWhatsAppProvider } from '../providers/whatsapp.provider.interface';
import { BaileysWhatsAppProvider } from '../providers/baileys-whatsapp.provider';
import { PartnerModel } from '../schemas/partner.schema';
import { NotificationLogModel } from '../schemas/notification-log.schema';
import { OrderPricingDetailDto } from '../../order/dto/order-pricing-detail.dto';
import { OrderFinancialSummary } from '../../order/services/order-financial-summary.service';
import { WhatsAppNotificationJobDto } from '../dto/whatsapp-notification-job.dto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Serviço de notificação WhatsApp
 * Formata e enfileira notificações de vendas
 */
@Injectable()
export class WhatsAppNotificationService {
  private logger = new Logger(WhatsAppNotificationService.name);
  private provider: IWhatsAppProvider;
  private groupId: string;

  constructor(
    @InjectModel('PartnerModel') private partnerModel: Model<PartnerModel>,
    @InjectModel('NotificationLogModel')
    private notificationLogModel: Model<NotificationLogModel>,
    private baileysProvider: BaileysWhatsAppProvider,
    private configService: ConfigService,
    private amqpConnection: AmqpConnection
  ) {
    this.provider = this.baileysProvider;
    this.groupId = this.configService.get('WHATSAPP_GROUP_ID', '');
  }

  /**
   * Envia notificação de venda para grupo de sócios
   * Fire-and-forget: enfileira em RabbitMQ, retorna imediatamente
   */
  async sendSaleNotification(order: any, pricing: OrderPricingDetailDto, financial?: OrderFinancialSummary): Promise<void> {
    const message = this.formatSaleMessage(order, pricing, financial);

    await this.enqueueWhatsAppText(message, {
      orderId: order._id?.toString(),
      externalOrderId: order.externalId,
      metadata: {
        grossProfit: pricing.totals.totalGrossProfit,
        netProfit: pricing.totals.totalNetProfit,
        marginPercent: pricing.totals.profitMarginPercent,
        marketplace: pricing.marketplace,
      },
    });
  }

  /**
   * Envia uma mensagem genérica de sistema para o grupo configurado.
   * Fire-and-forget: enfileira em RabbitMQ, retorna imediatamente.
   */
  async sendSystemMessage(title: string, body: string): Promise<void> {
    const text = `*${title}*\n${body}`;
    await this.enqueueWhatsAppText(text);
  }

  /**
   * Enfileira um texto livre como notificação WhatsApp (job + log de auditoria + publish).
   * Reutilizado por sendSaleNotification e sendSystemMessage para evitar duplicação.
   * Fire-and-forget: nunca lança — apenas loga o erro (não falha o fluxo chamador).
   */
  private async enqueueWhatsAppText(
    content: string,
    opts?: { orderId?: string; externalOrderId?: string; metadata?: Record<string, any> }
  ): Promise<void> {
    try {
      // 1. Preparar job
      const jobId = uuidv4();
      const job: WhatsAppNotificationJobDto = {
        jobId,
        destination: this.groupId, // Grupo configurado ou individual
        content,
        orderId: opts?.orderId,
        externalOrderId: opts?.externalOrderId,
        metadata: opts?.metadata,
      };

      // 2. Criar log de notificação (para auditoria)
      const logEntry = await this.notificationLogModel.create({
        jobId,
        type: 'whatsapp',
        destination: job.destination,
        orderId: opts?.orderId,
        externalOrderId: opts?.externalOrderId,
        content,
        metadata: job.metadata,
        status: 'queued',
        nextRetryAt: new Date(),
      });

      this.logger.debug(
        opts?.externalOrderId
          ? `Notification queued for order ${opts.externalOrderId} (jobId: ${jobId})`
          : `Notification queued (jobId: ${jobId})`
      );

      // 3. Enfileirar em RabbitMQ (fire-and-forget)
      await this.amqpConnection.publish(
        'rocket.notifications', // exchange
        'whatsapp.sale', // routing key
        job
      );

      // Atualizar log como queued
      await this.notificationLogModel.findByIdAndUpdate(logEntry._id, {
        status: 'queued',
      });

    } catch (error) {
      this.logger.error(
        opts?.externalOrderId
          ? `Error queueing WhatsApp notification for order ${opts.externalOrderId}: ${error.message}`
          : `Error queueing WhatsApp notification: ${error.message}`
      );
      // Não falha o fluxo chamador se notificação falhar
    }
  }

  /**
   * Formata a mensagem de venda em markdown.
   * Usa OrderFinancialSummary (já resolvido com a prioridade correta pelo serviço centralizado).
   * Fallback para order.payment + pricing quando financial não está disponível.
   */
  private formatSaleMessage(order: any, pricing: OrderPricingDetailDto, financial?: OrderFinancialSummary): string {
    const fmt = (v: number) =>
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

    // Usa dados do serviço centralizado se disponíveis
    const f = financial ?? this.buildFallbackSummary(order, pricing);

    const orderItems: any[] = order.items ?? order.order_items ?? [];
    const title      = orderItems[0]?.title || pricing.items?.[0]?.title || 'Produto';
    const extraItems = orderItems.length > 1 ? [`(+ ${orderItems.length - 1} item(ns))`] : [];
    const firstQty = Number(orderItems[0]?.quantity ?? pricing.items?.[0]?.quantity ?? 1);
    const firstUnitPrice = Number(orderItems[0]?.unitPrice ?? pricing.items?.[0]?.unitPrice ?? 0);
    const itemsTotal = orderItems.length > 0
      ? orderItems.reduce((sum, item) => sum + (Number(item?.quantity || 0) * Number(item?.unitPrice || 0)), 0)
      : Number(pricing.totals?.grossRevenue || f.gross || 0);

    const lines = [
      `📦 *NOVA VENDA*`,
      `🏪 Marketplace: ${(pricing.marketplace ?? order.marketplace ?? '').toUpperCase()}`,
      `📅 Data: ${new Date(order.createdAt).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      ``,
      `*${title}*`,
      ...extraItems,
      `Quantidade vendida: ${firstQty}`,
      ...(firstUnitPrice > 0 ? [`Preço unitário: ${fmt(firstUnitPrice)}`] : []),
      `Total itens: ${fmt(itemsTotal)}`,
      ``,
      `💰 *Valor bruto:* ${fmt(f.gross)}`,
      ...(f.saleFee > 0 ? [`  └ Comissão: -${fmt(f.saleFee)}`]         : []),
      ...(f.freight > 0 ? [`  └ Frete (vendedor): -${fmt(f.freight)}`] : []),
      ...(f.taxes   > 0 ? [`  └ Impostos: -${fmt(f.taxes)}`]           : []),
      `💵 *Receita líquida:* ${fmt(f.net)}`,
      ...(f.costTotal > 0 ? [`  └ Custo dos produtos: -${fmt(f.costTotal)}`] : []),
      ``,
      `✅ *Lucro bruto estimado:* ${fmt(f.grossProfit)}`,
      `📈 *Margem:* ${f.marginPct.toFixed(1)}%`,
      ``,
      `👤 Comprador: ${order.customer?.name || 'N/A'}`,
      `🔗 Pedido: ${order.externalId}`,
    ];

    return lines.join('\n');
  }

  /** Fallback simples usando order.payment + pricing (sem chamadas externas) */
  private buildFallbackSummary(order: any, pricing: OrderPricingDetailDto): OrderFinancialSummary {
    const p = order.payment ?? {};
    const { totals } = pricing;
    const gross    = Number(p.grossAmount    || totals.grossRevenue    || order.totalAmount || 0);
    const saleFee  = Number(p.marketplaceFee || totals.totalCommission || 0);
    const freight  = Number(order.shippingAmount || totals.totalFreight || 0);
    const taxes    = Number(p.taxAmount      || totals.totalTaxes      || 0);
    const coupon   = 0;
    const net      = Number(p.netAmount      || Math.max(0, gross - saleFee - freight - taxes));
    const costTotal = totals.totalCostOfGoods ?? 0;
    const grossProfit = net - costTotal;
    const marginPct   = gross > 0 ? (grossProfit / gross) * 100 : 0;
    return { gross, saleFee, freight, coupon, taxes, net, costTotal, grossProfit, marginPct, charges: [], taxDetails: [] };
  }

  /**
   * Obtém status de conexão (para debug)
   */
  async getProviderStatus(): Promise<any> {
    return this.provider.getStatus();
  }

  /**
   * Marca notificação como entregue
   */
  async markDelivered(jobId: string): Promise<void> {
    await this.notificationLogModel.findOneAndUpdate(
      { jobId },
      {
        status: 'delivered',
        deliveredAt: new Date(),
        attempts: { $inc: 1 },
      }
    );
  }

  /**
   * Marca como falhada e agenda retry
   */
  async markFailed(jobId: string, error: string, delayMs: number): Promise<void> {
    const nextRetryAt = new Date(Date.now() + delayMs);

    await this.notificationLogModel.findOneAndUpdate(
      { jobId },
      {
        status: 'pending',
        error,
        $inc: { attempts: 1 },
        nextRetryAt,
      }
    );
  }

  /**
   * Marca como expirada (excedeu número de tentativas)
   */
  async markExpired(jobId: string): Promise<void> {
    await this.notificationLogModel.findOneAndUpdate(
      { jobId },
      {
        status: 'failed',
        error: 'Max retries exceeded',
        expireAt: new Date(),
      }
    );
  }
}

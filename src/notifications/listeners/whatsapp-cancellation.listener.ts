import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderCancelledEvent } from '../../order/events/order.events';
import { BaileysWhatsAppProvider } from '../providers/baileys-whatsapp.provider';
import { ConfigService } from '@nestjs/config';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const CANCEL_REASON_LABELS: Record<string, string> = {
  buyer_cancel_express:      'Solicitação do comprador',
  buyer_cancel:              'Solicitação do comprador',
  seller_cancel:             'Cancelamento pelo vendedor',
  out_of_stock:              'Produto sem estoque',
  product_not_found:         'Produto não encontrado',
  address_problems:          'Problema com endereço',
  payment_not_confirmed:     'Pagamento não confirmado',
  fraud:                     'Fraude detectada',
  'There is a mediation with status cancel_purchase': 'Mediação de cancelamento',
};

@Injectable()
export class WhatsAppCancellationListener {
  private readonly logger = new Logger(WhatsAppCancellationListener.name);
  private readonly groupId: string;

  constructor(
    private readonly baileys: BaileysWhatsAppProvider,
    private readonly configService: ConfigService,
  ) {
    this.groupId = this.configService.get('WHATSAPP_GROUP_ID', '');
  }

  @OnEvent(ORDER_EVENTS.CANCELLED, { async: true })
  async handleCancelled(event: OrderCancelledEvent): Promise<void> {
    if (event.triggeredBy !== 'webhook') return;

    try {
      const message = this.formatMessage(event);
      await this.baileys.sendMessage(this.groupId, message);
      this.logger.log(`Cancellation notification sent for order ${event.externalId}`);
    } catch (err) {
      this.logger.error(`Failed to send cancellation notification for order ${event.externalId}: ${err.message}`);
    }
  }

  private formatMessage(event: OrderCancelledEvent): string {
    const reasonRaw = event.cancelReason ?? '';
    const reason = CANCEL_REASON_LABELS[reasonRaw] ?? (reasonRaw || 'Não informado');
    const cancelledBy = event.cancelledBy === 'buyer' ? 'Comprador' :
                        event.cancelledBy === 'seller' ? 'Vendedor' :
                        event.cancelledBy ?? 'Sistema';

    const lines = [
      `❌ *Pedido Cancelado*`,
      ``,
      `📦 Pedido: ${event.externalId}`,
      `💰 Valor: ${fmt(event.totalAmount)}`,
      `👤 Cancelado por: ${cancelledBy}`,
      `📋 Motivo: ${reason}`,
      ...(event.stockReverted
        ? [`♻️ Estoque revertido automaticamente`]
        : []),
    ];

    return lines.join('\n');
  }
}

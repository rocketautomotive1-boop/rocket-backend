import { Injectable } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import {
  ORDER_EVENTS,
  OrderProcessedEvent,
  OrderCancelledEvent,
  OrderSaleNotificationEvent,
  OrderShippingUpdatedEvent,
} from '../../order/events/order.events';
import { NOTIFICATION_EVENTS } from '../events/notification.events';
import { NotificationRequested } from '../contracts/notification-requested.event';
import { formatSaleMessage } from '../format/sale-message.formatter';
import { formatCancellationMessage } from '../format/cancellation-message.formatter';

/**
 * Ponte order → notifications. Importa SOMENTE os tipos de evento de order
 * (não o OrderModule). Converte eventos de domínio em NotificationRequested,
 * incluindo o texto WhatsApp já formatado quando aplicável.
 */
@Injectable()
export class OrderNotificationTranslator {
  constructor(private readonly emitter: EventEmitter2) {}

  @OnEvent(ORDER_EVENTS.PROCESSED, { async: true })
  onProcessed(event: OrderProcessedEvent): void {
    const req: NotificationRequested = {
      type: 'order.processed', aggregateType: 'order', aggregateId: event.orderId,
      title: `Nova venda - ${event.marketplaceName || 'Marketplace'}`,
      body: `Pedido ${event.externalId} recebido`,
      severity: 'success',
      deduplicationKey: `order.processed:${event.marketplaceId}:${event.externalId}`,
      source: event.triggeredBy as any,
      data: {
        externalId: event.externalId, marketplaceId: event.marketplaceId,
        marketplaceName: event.marketplaceName, totalAmount: event.totalAmount,
        itemCount: event.items?.length || 0, actionRoute: '/(drawer)/orders',
      },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);
  }

  /**
   * Marco de envio (shipped/out_for_delivery/delivered/...) → notificação SÓ no app
   * (sino + push + websocket via pipeline). Sem `channels` = sem WhatsApp por decisão de
   * produto. Dedup por (externalId, substatus) evita repetir o mesmo marco quando webhook
   * e reconciler pegam a mesma transição.
   */
  @OnEvent(ORDER_EVENTS.SHIPPING_UPDATED, { async: true })
  onShippingUpdated(event: OrderShippingUpdatedEvent): void {
    const isReturn = event.substatus === 'returning_to_sender';
    const req: NotificationRequested = {
      type: 'order.shipping', aggregateType: 'order', aggregateId: event.orderId,
      title: shippingTitle(event.substatus),
      body: `Pedido ${event.externalId}`,
      severity: (event.substatus === 'not_delivered' || isReturn) ? 'warning' : 'info',
      deduplicationKey: `order.shipping:${event.externalId}:${event.substatus}`,
      source: event.triggeredBy as any,
      data: {
        externalId: event.externalId, marketplaceId: event.marketplaceId,
        marketplaceName: event.marketplaceName, substatus: event.substatus,
        trackingCode: event.trackingCode ?? undefined, actionRoute: '/(drawer)/orders',
      },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);

    // Devolução logística (pacote voltando ao remetente) → também no WhatsApp. O evento de
    // shipping não carrega itens/comprador, então a mensagem é enxuta (pedido + rastreio).
    // 'sync' (fix em massa) fica silencioso; dedup evita repetir o mesmo marco.
    if (isReturn && event.triggeredBy !== 'sync') {
      const lines = [
        `🔁 *DEVOLUÇÃO EM TRÂNSITO*`,
        `🏪 Marketplace: ${(event.marketplaceName ?? '').toUpperCase()}`,
        `📦 O pacote está voltando ao remetente.`,
        ...(event.trackingCode ? [`🚚 Rastreio: ${event.trackingCode}`] : []),
        `🔗 Pedido: ${event.externalId}`,
      ];
      this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
        type: 'order.shipping.return.whatsapp', aggregateType: 'order', aggregateId: event.orderId,
        title: 'Devolução em trânsito', body: lines.join('\n'),
        severity: 'warning',
        channels: ['whatsapp'],
        deduplicationKey: `order.shipping.return.whatsapp:${event.externalId}`,
        source: event.triggeredBy as any,
        data: { externalId: event.externalId, substatus: event.substatus },
      } as NotificationRequested);
    }
  }

  /**
   * Venda com financeiro resolvido → notificação WhatsApp (texto já formatado aqui).
   * O canal WhatsApp só enfileira o body; reenvio manual ignora dedup.
   */
  @OnEvent(ORDER_EVENTS.SALE_NOTIFICATION, { async: true })
  onSaleNotification(event: OrderSaleNotificationEvent): void {
    const body = formatSaleMessage({
      marketplace: event.marketplace,
      createdAt: event.createdAt,
      firstItemTitle: event.firstItemTitle,
      extraItemsCount: event.extraItemsCount,
      firstQty: event.firstQty,
      firstUnitPrice: event.firstUnitPrice,
      itemsTotal: event.itemsTotal,
      buyerName: event.buyerName,
      externalId: event.externalId,
      financial: event.financial,
    });

    const req: NotificationRequested = {
      type: 'order.sale', aggregateType: 'order', aggregateId: event.orderId,
      title: 'Nova venda', body,
      severity: 'success',
      channels: ['whatsapp'],
      deduplicationKey: event.triggeredBy === 'manual'
        ? undefined
        : `order.sale:${event.externalId}`,
      source: event.triggeredBy as any,
      data: { externalId: event.externalId, ...event.financial },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);
  }

  @OnEvent(ORDER_EVENTS.CANCELLED, { async: true })
  onCancelled(event: OrderCancelledEvent): void {
    const req: NotificationRequested = {
      type: 'order.cancelled', aggregateType: 'order', aggregateId: event.orderId,
      title: `Pedido cancelado - ${event.marketplaceName || 'Marketplace'}`,
      body: `Pedido ${event.externalId} cancelado`,
      severity: 'warning',
      deduplicationKey: `order.cancelled:${event.marketplaceId}:${event.externalId}`,
      source: event.triggeredBy as any,
      data: {
        externalId: event.externalId, marketplaceId: event.marketplaceId,
        marketplaceName: event.marketplaceName, totalAmount: event.totalAmount,
        cancelReason: event.cancelReason, cancelledBy: event.cancelledBy,
        stockReverted: event.stockReverted, actionRoute: '/(drawer)/orders',
      },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);

    // WhatsApp dispara em detecções REAL-TIME (webhook/reconcile/gap-detector): o reconciler
    // existe para pegar o que o webhook perdeu, então um cancelamento que ele detecta é tão
    // real quanto um de webhook. Só 'sync' (fix em massa) fica silencioso. A deduplicationKey
    // abaixo evita duplicar caso webhook e reconcile peguem o mesmo cancelamento.
    if (event.triggeredBy !== 'sync') {
      const waBody = formatCancellationMessage({
        externalId: event.externalId,
        marketplace: event.marketplaceName,
        soldAt: event.soldAt,
        firstItemTitle: event.firstItemTitle,
        firstQty: event.firstQty,
        extraItemsCount: event.extraItemsCount,
        totalAmount: event.totalAmount,
        cancelledBy: event.cancelledBy,
        cancelReason: event.cancelReason,
        stockReverted: event.stockReverted,
      });
      this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, {
        type: 'order.cancelled.whatsapp', aggregateType: 'order', aggregateId: event.orderId,
        title: 'Pedido cancelado', body: waBody,
        severity: 'warning',
        channels: ['whatsapp'],
        deduplicationKey: `order.cancelled.whatsapp:${event.marketplaceId}:${event.externalId}`,
        source: event.triggeredBy as any,
        data: { externalId: event.externalId },
      } as NotificationRequested);
    }
  }
}

/** Título PT-BR por marco de envio (substatus do marketplace). */
function shippingTitle(substatus: string): string {
  switch (substatus) {
    case 'shipped': return 'Pedido enviado';
    case 'out_for_delivery': return 'Pedido saiu para entrega';
    case 'delivered': return 'Pedido entregue';
    case 'not_delivered': return 'Falha na entrega';
    case 'returning_to_sender': return 'Pedido em devolução';
    default: return 'Atualização de entrega';
  }
}

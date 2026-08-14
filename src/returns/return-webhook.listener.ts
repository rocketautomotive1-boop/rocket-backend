import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { MarketplaceRegistryService } from '../marketplace/services/marketplace-registry.service';
import { MarketplaceTokenBrokerService } from '../marketplace/auth/services/marketplace-token-broker.service';
import { MlClaimsClient } from './ml/ml-claims.client';
import {
  WEBHOOK_DOMAIN_COMMANDS,
  ReturnIngestRequestedCommand,
} from '../webhook/events/webhook.events';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';
import { NotificationRequested } from '../notifications/contracts/notification-requested.event';
import { formatReturnMessage } from '../notifications/format/return-message.formatter';

/**
 * Devoluções/reclamações pós-venda (ML topic `claims`). Espelha o ModerationWebhookListener:
 * resolve a conta dona via broker (multi-client), busca o claim na API com o token da conta
 * (live, nunca cacheado) e emite UMA NotificationRequested com app (push/sino) + WhatsApp.
 * Detector, não executor — não toca pedido/estoque; só notifica.
 */
@Injectable()
export class ReturnWebhookListener {
  private readonly logger = new Logger(ReturnWebhookListener.name);

  constructor(
    private readonly registry: MarketplaceRegistryService,
    private readonly broker: MarketplaceTokenBrokerService,
    private readonly claimsClient: MlClaimsClient,
    private readonly emitter: EventEmitter2,
  ) {}

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.RETURN_INGEST_REQUESTED, { async: true })
  async onReturn(cmd: ReturnIngestRequestedCommand): Promise<void> {
    if (cmd.marketplace !== 'mercadolivre' || !cmd.externalId) return;

    const mkt = await this.registry.findByTag('mercadolivre').catch(() => null);
    if (!mkt) return;
    const marketplaceId = String(mkt._id);

    // Resolve a conta destino a partir do seller user_id do webhook (multi-client) e o token vivo.
    let accessToken: string;
    try {
      let accountId: string | null = null;
      if (cmd.externalUserId) {
        const ref = await this.broker.resolveAccountByExternalUserId(marketplaceId, cmd.externalUserId);
        accountId = ref?.accountId ?? null;
      }
      const token = accountId
        ? await this.broker.ensureValidTokenByAccount(marketplaceId, accountId)
        : await this.broker.ensureValidToken(marketplaceId);
      accessToken = token.accessToken;
    } catch (err) {
      this.logger.warn(`[Return] claim ${cmd.externalId}: sem token — ${(err as Error).message}`);
      return;
    }

    const claim = await this.claimsClient.getClaimSummary(cmd.externalId, accessToken);
    if (!claim) return;

    const waBody = formatReturnMessage({
      claimId: claim.id,
      marketplace: mkt.name || 'Mercado Livre',
      claimType: claim.type,
      stage: claim.stage,
      orderId: claim.orderId,
      buyerName: claim.buyerName,
      firstItemTitle: claim.firstItemTitle,
      firstQty: claim.firstQty,
      extraItemsCount: claim.extraItemsCount,
      totalAmount: claim.totalAmount,
      soldAt: claim.soldAt,
    });

    // App (push/sino/persist) + WhatsApp numa única notificação. aggregateType 'order'
    // (devolução é pós-venda, ligada ao pedido); o `type` 'order.return' diferencia no app.
    const req: NotificationRequested = {
      type: 'order.return',
      aggregateType: 'order',
      aggregateId: claim.orderId ?? claim.id,
      title: 'Devolução / Reclamação',
      body: waBody,
      severity: 'warning',
      channels: ['persist', 'push', 'websocket', 'whatsapp'],
      deduplicationKey: `order.return:${marketplaceId}:${claim.id}`,
      source: 'webhook',
      data: {
        claimId: claim.id,
        externalId: claim.orderId ?? undefined,
        claimType: claim.type,
        stage: claim.stage,
        marketplace: 'mercadolivre',
        actionRoute: '/(drawer)/orders',
      },
    };
    this.emitter.emit(NOTIFICATION_EVENTS.REQUESTED, req);
    this.logger.log(`[Return] claim ${claim.id} (${claim.type}/${claim.stage}) → notificado`);
  }
}

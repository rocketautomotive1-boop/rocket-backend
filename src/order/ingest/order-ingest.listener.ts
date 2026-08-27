import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import axios from 'axios';
import { OrderIngestService } from './order-ingest.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MercadoLivreAuthAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';
import { MarketplaceTokenBrokerService } from '../../marketplace/auth/services/marketplace-token-broker.service';
import {
  OrderPackSyncRequestedCommand,
  OrderSyncRequestedCommand,
  ShipmentSyncRequestedCommand,
  WEBHOOK_DOMAIN_COMMANDS,
} from '../../webhook/events/webhook.events';

/**
 * Inbound bridge: webhook domain commands → order ingestion. Replaces the legacy
 * OrderWebhookCommandListener; routes through OrderIngestService.ingest() (direct, no queue).
 */
@Injectable()
export class OrderIngestListener {
  private readonly logger = new Logger(OrderIngestListener.name);

  constructor(
    private readonly ingest: OrderIngestService,
    private readonly marketplaceService: MarketplaceService,
    private readonly mlAuth: MercadoLivreAuthAdapter,
    private readonly broker: MarketplaceTokenBrokerService,
  ) {}

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.ORDER_SYNC_REQUESTED, { async: true })
  async onSync(cmd: OrderSyncRequestedCommand): Promise<void> {
    const mktId = await this.resolveMarketplaceId(cmd.marketplace);
    if (!mktId) return;
    const accountId = await this.resolveAccountId(mktId, cmd.externalUserId, cmd.externalOrderId);
    if (accountId === false) return; // conta desconhecida → não rotear (falha fechada)
    this.logger.log(`[Ingest] sync requested ${cmd.marketplace} externalId=${cmd.externalOrderId}${accountId ? ` account=${accountId}` : ''}`);
    await this.ingest.ingest(cmd.externalOrderId, mktId, cmd.source as any, accountId || undefined);
  }

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.ORDER_PACK_SYNC_REQUESTED, { async: true })
  async onPack(cmd: OrderPackSyncRequestedCommand): Promise<void> {
    const mktId = await this.resolveMarketplaceId(cmd.marketplace);
    if (!mktId) return;
    const accountId = await this.resolveAccountId(mktId, cmd.externalUserId, `pack:${cmd.externalPackId}`);
    if (accountId === false) return;

    const ids = await this.expandMlPack(cmd.externalPackId, accountId || undefined);
    if (!ids.length) {
      this.logger.warn(`[Ingest] Pack ${cmd.externalPackId} expanded to 0 orders`);
      return;
    }
    this.logger.log(`[Ingest] Pack ${cmd.externalPackId} → orders: ${ids.join(', ')}`);
    for (const id of ids) await this.ingest.ingest(id, mktId, cmd.source as any, accountId || undefined);
  }

  /**
   * ML topic `shipments` → resource `/shipments/{shipment_id}`, não o id do pedido.
   * `GET /shipments/{id}` já traz `order_id` no payload — resolve e reingesta o pedido
   * dono, exatamente como uma sync normal (mesmo pipeline, mesma fonte de verdade).
   */
  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.SHIPMENT_SYNC_REQUESTED, { async: true })
  async onShipment(cmd: ShipmentSyncRequestedCommand): Promise<void> {
    const mktId = await this.resolveMarketplaceId(cmd.marketplace);
    if (!mktId) return;
    const accountId = await this.resolveAccountId(mktId, cmd.externalUserId, `shipment:${cmd.externalShipmentId}`);
    if (accountId === false) return;

    const orderId = await this.resolveOrderIdFromShipment(cmd.externalShipmentId, accountId || undefined);
    if (!orderId) {
      this.logger.warn(`[Ingest] Shipment ${cmd.externalShipmentId} não resolveu para nenhum pedido`);
      return;
    }
    this.logger.log(`[Ingest] Shipment ${cmd.externalShipmentId} → pedido ${orderId}`);
    await this.ingest.ingest(orderId, mktId, cmd.source as any, accountId || undefined);
  }

  private async resolveMarketplaceId(marketplace: string): Promise<string | null> {
    const mkt = await this.marketplaceService.findByTag(marketplace);
    if (!mkt) {
      this.logger.warn(`[Ingest] marketplace not found for tag: ${marketplace}`);
      return null;
    }
    return mkt._id.toString();
  }

  /**
   * Resolve a conta multi-client a partir do user_id do marketplace.
   *  - sem externalUserId → null (single-client legado; cai na conta default)
   *  - com externalUserId que casa → accountId
   *  - com externalUserId que NÃO casa nenhuma conta → false (falha fechada:
   *    NÃO roteia para a conta default, evitando contabilizar pedido na conta errada)
   */
  private async resolveAccountId(
    marketplaceId: string,
    externalUserId: string | null | undefined,
    ctx: string,
  ): Promise<string | null | false> {
    if (!externalUserId) return null;
    const account = await this.broker.resolveAccountByExternalUserId(marketplaceId, externalUserId);
    if (!account) {
      this.logger.warn(`[Ingest] user_id=${externalUserId} não casou nenhuma conta (mkt=${marketplaceId}, ${ctx}). Ignorando — conta desconhecida.`);
      return false;
    }
    return account.accountId;
  }

  private async resolveOrderIdFromShipment(shipmentId: string, accountId?: string): Promise<string | null> {
    try {
      const selector = accountId ? { accountId } : undefined;
      const token = await this.mlAuth.getValidToken('Mercado Livre', selector);
      const res = await axios.get(`https://api.mercadolibre.com/shipments/${shipmentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const orderId = res.data?.order_id;
      return orderId ? String(orderId) : null;
    } catch (e) {
      this.logger.error(`[Ingest] shipment→order resolve failed ${shipmentId}: ${(e as Error).message}`);
      return null;
    }
  }

  private async expandMlPack(packId: string, accountId?: string): Promise<string[]> {
    try {
      const selector = accountId ? { accountId } : undefined;
      const token = await this.mlAuth.getValidToken('Mercado Livre', selector);
      const me = await axios.get('https://api.mercadolibre.com/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res = await axios.get('https://api.mercadolibre.com/orders/search', {
        headers: { Authorization: `Bearer ${token}` },
        params: { seller: me.data.id, pack: packId },
      });
      return (res.data.results || []).map((o: any) => String(o.id));
    } catch (e) {
      this.logger.error(`[Ingest] pack expand failed ${packId}: ${(e as Error).message}`);
      return [];
    }
  }
}

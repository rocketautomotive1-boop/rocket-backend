import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import axios from 'axios';
import { OrderIngestService } from './order-ingest.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MercadoLivreAuthAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';
import {
  OrderPackSyncRequestedCommand,
  OrderSyncRequestedCommand,
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
  ) {}

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.ORDER_SYNC_REQUESTED, { async: true })
  async onSync(cmd: OrderSyncRequestedCommand): Promise<void> {
    const mktId = await this.resolveMarketplaceId(cmd.marketplace);
    if (!mktId) return;
    this.logger.log(`[Ingest] sync requested ${cmd.marketplace} externalId=${cmd.externalOrderId}`);
    await this.ingest.ingest(cmd.externalOrderId, mktId, cmd.source as any);
  }

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.ORDER_PACK_SYNC_REQUESTED, { async: true })
  async onPack(cmd: OrderPackSyncRequestedCommand): Promise<void> {
    const mktId = await this.resolveMarketplaceId(cmd.marketplace);
    if (!mktId) return;

    const ids = await this.expandMlPack(cmd.externalPackId);
    if (!ids.length) {
      this.logger.warn(`[Ingest] Pack ${cmd.externalPackId} expanded to 0 orders`);
      return;
    }
    this.logger.log(`[Ingest] Pack ${cmd.externalPackId} → orders: ${ids.join(', ')}`);
    for (const id of ids) await this.ingest.ingest(id, mktId, cmd.source as any);
  }

  private async resolveMarketplaceId(marketplace: string): Promise<string | null> {
    const mkt = await this.marketplaceService.findByTag(marketplace);
    if (!mkt) {
      this.logger.warn(`[Ingest] marketplace not found for tag: ${marketplace}`);
      return null;
    }
    return mkt._id.toString();
  }

  private async expandMlPack(packId: string): Promise<string[]> {
    try {
      const token = await this.mlAuth.getValidToken('Mercado Livre');
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

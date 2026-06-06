import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import axios from 'axios';
import { OrderService } from '../order.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { MercadoLivreAuthAdapter } from '../../marketplace/adapters/mercado-livre/mercado-livre-auth.adapter';
import {
  OrderPackSyncRequestedCommand,
  OrderSyncRequestedCommand,
  WEBHOOK_DOMAIN_COMMANDS,
} from '../../webhook/events/webhook.events';

@Injectable()
export class OrderWebhookCommandListener {
  private readonly logger = new Logger(OrderWebhookCommandListener.name);

  constructor(
    private readonly orderService: OrderService,
    private readonly marketplaceService: MarketplaceService,
    private readonly mlAuth: MercadoLivreAuthAdapter,
  ) {}

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.ORDER_SYNC_REQUESTED, { async: true })
  async handleOrderSyncRequested(command: OrderSyncRequestedCommand): Promise<void> {
    const marketplaceId = await this.resolveMarketplaceId(command.marketplace);
    if (!marketplaceId) return;

    this.logger.log(
      `[OrderWebhook] Sync requested ${command.marketplace} externalId=${command.externalOrderId}`,
    );
    await this.orderService.enqueueSyncOrder(command.externalOrderId, marketplaceId, command.source);
  }

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.ORDER_PACK_SYNC_REQUESTED, { async: true })
  async handleOrderPackSyncRequested(command: OrderPackSyncRequestedCommand): Promise<void> {
    const marketplaceId = await this.resolveMarketplaceId(command.marketplace);
    if (!marketplaceId) return;

    const orderIds = await this.expandMlPack(command.externalPackId);
    if (!orderIds.length) {
      this.logger.warn(`[OrderWebhook] Pack ${command.externalPackId} expanded to 0 orders`);
      return;
    }

    this.logger.log(
      `[OrderWebhook] Pack ${command.externalPackId} expanded to orders: ${orderIds.join(', ')}`,
    );

    for (const externalOrderId of orderIds) {
      await this.orderService.enqueueSyncOrder(externalOrderId, marketplaceId, command.source);
    }
  }

  private async resolveMarketplaceId(marketplace: string): Promise<string | null> {
    const mkt = await this.marketplaceService.findByTag(marketplace);
    if (!mkt) {
      this.logger.warn(`[OrderWebhook] Marketplace not found for tag: ${marketplace}`);
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
      const sellerId = me.data.id;
      const res = await axios.get('https://api.mercadolibre.com/orders/search', {
        headers: { Authorization: `Bearer ${token}` },
        params: { seller: sellerId, pack: packId },
      });
      return (res.data.results || []).map((order: any) => String(order.id));
    } catch (err) {
      this.logger.error(`[OrderWebhook] Failed to expand ML pack ${packId}: ${(err as Error).message}`);
      return [];
    }
  }
}

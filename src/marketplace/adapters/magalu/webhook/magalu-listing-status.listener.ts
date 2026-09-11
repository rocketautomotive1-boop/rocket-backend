import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MarketplaceRegistryService } from '../../../services/marketplace-registry.service';
import { MagaluProductAdapter } from '../magalu-product.adapter';
import { ListingService } from '../../../../listing/listing.service';
import {
  WEBHOOK_DOMAIN_COMMANDS,
  ListingStatusSyncRequestedCommand,
} from '../../../../webhook/events/webhook.events';

/**
 * Mapa status Magalu (`portfolios_sku`/`portfolios_price`/`portfolios_stock`) →
 * ListingModel.status. Magalu processa o SKU assincronamente e não expõe um jeito
 * de forçar essa transição — o webhook é a única forma de saber quando mudou (não
 * dá pra confiar em polling: sem timestamp de "próxima revisão").
 *
 * policies_info/policies_warn/promotion_started/promotion_finished não mudam o
 * status de publicação (avisos/eventos informativos) — ficam de fora do mapa e só
 * são logados.
 */
const STATUS_MAP: Record<string, string> = {
  new: 'pending_creation',
  draft: 'pending_creation',
  policies_approved: 'active',
  published: 'active',
  policies_blocked: 'error',
  policies_blocked_price: 'error',
  publishing_error: 'error',
  unpublished: 'paused',
  inactivated: 'paused',
};

/**
 * Low-latency trigger (mesmo padrão do ModerationWebhookListener): o webhook só
 * avisa QUE algo mudou; a fonte de verdade é sempre a API (GET /portfolios/skus/:sku)
 * — nunca confiamos no payload do webhook para o status final. `externalId`
 * (o `sku` do payload) é o nosso productId, já que a publicação Magalu é
 * idempotente por sku (ver magalu-payload.builder.ts, orchestrator).
 *
 * Vive dentro de marketplace/ (não listing/) para evitar ciclo: MarketplaceModule
 * já importa ListingModule; o inverso exigiria forwardRef.
 *
 * Resolve o Listing por (marketplaceId, productId) — assume single-store para
 * Magalu por ora (mesma decisão de "só uma conta" do design inicial); um produto
 * com listings em múltiplas lojas no Magalu exigiria o sku carregar o storeId,
 * o que não é o caso hoje.
 */
@Injectable()
export class MagaluListingStatusListener {
  private readonly logger = new Logger(MagaluListingStatusListener.name);

  constructor(
    private readonly registry: MarketplaceRegistryService,
    private readonly productAdapter: MagaluProductAdapter,
    private readonly listingService: ListingService,
  ) {}

  @OnEvent(WEBHOOK_DOMAIN_COMMANDS.LISTING_STATUS_SYNC_REQUESTED)
  async onStatusSync(cmd: ListingStatusSyncRequestedCommand): Promise<void> {
    if (cmd.marketplace !== 'magalu' || !cmd.externalId) return;

    const mkt = await this.registry.findByTag('magalu').catch(() => null);
    if (!mkt) return;

    const listing = await this.listingService.findOne({
      marketplaceId: mkt._id,
      productId: cmd.externalId,
    });
    if (!listing) {
      this.logger.debug(`[Magalu] listing_status sku=${cmd.externalId}: nenhum Listing local — no-op`);
      return;
    }

    let remoteStatus: string;
    try {
      const detail = await this.productAdapter.getListingDetail(cmd.externalId);
      remoteStatus = String(detail?.status ?? '').toLowerCase();
    } catch (err) {
      this.logger.warn(`[Magalu] listing_status sku=${cmd.externalId}: falha ao consultar API — ${(err as Error).message}`);
      return;
    }

    const mapped = STATUS_MAP[remoteStatus];
    if (!mapped) {
      this.logger.debug(`[Magalu] listing_status sku=${cmd.externalId}: status "${remoteStatus}" não mapeado — no-op (informativo)`);
      return;
    }

    const errorMessage = mapped === 'error' ? `Magalu: status ${remoteStatus}` : undefined;
    await this.listingService.updateStatus(String(listing._id), mapped, errorMessage);
    this.logger.log(`[Magalu] listing_status sku=${cmd.externalId}: ${remoteStatus} → Listing.status=${mapped}`);
  }
}

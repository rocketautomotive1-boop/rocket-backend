import { Injectable, Logger } from '@nestjs/common';
import {
  MarketplaceOrderGateway,
  ExternalOrder,
  ExternalOrderRef,
} from '../../order/ports/marketplace-order.gateway';
import { MarketplaceRegistryService } from '../services/marketplace-registry.service';
import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';

/**
 * Pure implementation of the order's MarketplaceOrderGateway port.
 * Talks ONLY to the marketplace API (registry + adapters). It never reads the local
 * Order collection — all comparison with our DB lives on the order side. This keeps the
 * boundary clean and ready to become an HTTP call to an external service later.
 */
@Injectable()
export class MarketplaceOrderGatewayProvider implements MarketplaceOrderGateway {
  private readonly logger = new Logger(MarketplaceOrderGatewayProvider.name);

  constructor(
    private readonly registry: MarketplaceRegistryService,
    private readonly adapters: MarketplaceAdapterRegistry,
  ) {}

  async fetchOrder(externalId: string, marketplaceId: string, accountId?: string): Promise<ExternalOrder | null> {
    const mkt = await this.registry.findOne(marketplaceId);
    if (!mkt) return null;
    if (!this.adapters.hasOrderAdapter(mkt.name)) return null;
    const adapter = this.adapters.getOrderAdapter(mkt.name);
    const detail = await adapter.getOrderDetails(externalId, accountId);
    if (!detail) return null;
    return {
      ...(detail as any),
      marketplaceId: String(mkt._id),
      marketplaceName: mkt.name,
      marketplaceTag: mkt.tag,
    } as ExternalOrder;
  }

  /** Teto de página seguro p/ qualquer marketplace (ML rejeita /orders/search com limit>51). */
  private static readonly PAGE_SIZE = 50;
  /** Trava dura anti-loop caso um adapter ignore offset/since e devolva sempre página cheia. */
  private static readonly MAX_PAGES = 200;

  async listOrdersSince(marketplaceId: string, cursor: Date, accountId?: string): Promise<ExternalOrderRef[]> {
    const mkt = await this.registry.findOne(marketplaceId);
    if (!mkt) return [];
    if (!this.adapters.hasOrderAdapter(mkt.name)) return [];
    const adapter = this.adapters.getOrderAdapter(mkt.name);

    // Delta SERVER-SIDE: o filtro de data fica no marketplace (passamos `since: cursor`), que
    // devolve só os pedidos atualizados após o cursor, em ordem crescente. Não baixamos o
    // histórico para filtrar no cliente — com 1M de pedidos lemos apenas o delta (O(delta)).
    // Paginamos enquanto o servidor devolver páginas cheias. Retorna apenas refs.
    const { PAGE_SIZE, MAX_PAGES } = MarketplaceOrderGatewayProvider;
    const collected: ExternalOrderRef[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await adapter.getOrders({
        since: cursor,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        accountId,
      });
      if (!batch || batch.length === 0) break;

      for (const o of batch as any[]) {
        collected.push({
          id: String(o.id),
          status: String(o.status ?? 'unknown'),
          date_last_updated: String(
            o.date_last_updated ?? o.date_created ?? new Date().toISOString(),
          ),
        });
      }

      if (batch.length < PAGE_SIZE) break; // última página
    }

    return collected.sort(
      (a, b) =>
        new Date(a.date_last_updated).getTime() - new Date(b.date_last_updated).getTime(),
    );
  }

  async getBillingInfo(billingId: string, marketplaceId: string, accountId?: string): Promise<any> {
    const mkt = await this.registry.findOne(marketplaceId);
    if (!mkt) return null;
    const adapter = this.adapters.getOrderAdapter(mkt.name);
    if (!adapter.getBillingInfo) return null;
    return adapter.getBillingInfo(billingId, accountId);
  }
}

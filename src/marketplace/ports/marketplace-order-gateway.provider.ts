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

  async fetchOrder(externalId: string, marketplaceId: string): Promise<ExternalOrder | null> {
    const mkt = await this.registry.findOne(marketplaceId);
    if (!mkt) return null;
    if (!this.adapters.hasOrderAdapter(mkt.name)) return null;
    const adapter = this.adapters.getOrderAdapter(mkt.name);
    const detail = await adapter.getOrderDetails(externalId);
    if (!detail) return null;
    return {
      ...(detail as any),
      marketplaceId: String(mkt._id),
      marketplaceName: mkt.name,
    } as ExternalOrder;
  }

  async listOrdersSince(marketplaceId: string, cursor: Date): Promise<ExternalOrderRef[]> {
    const mkt = await this.registry.findOne(marketplaceId);
    if (!mkt) return [];
    if (!this.adapters.hasOrderAdapter(mkt.name)) return [];
    const adapter = this.adapters.getOrderAdapter(mkt.name);

    // Adapters expose getOrders({status,limit,offset}); an incremental date filter is
    // adapter-specific and not yet part of the interface. Until it is, fetch a recent page
    // and filter client-side by cursor (sliding-window degradation). Returns refs only.
    const orders = await adapter.getOrders({ limit: 100, offset: 0 });
    return (orders || [])
      .map((o: any) => ({
        id: String(o.id),
        status: String(o.status ?? 'unknown'),
        date_last_updated: String(
          o.date_last_updated ?? o.date_created ?? new Date().toISOString(),
        ),
      }))
      .filter((o: ExternalOrderRef) => new Date(o.date_last_updated) > cursor)
      .sort(
        (a, b) =>
          new Date(a.date_last_updated).getTime() - new Date(b.date_last_updated).getTime(),
      );
  }
}

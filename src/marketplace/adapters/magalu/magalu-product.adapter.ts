import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IMarketplaceProductAdapter } from '../../interfaces/marketplace-product-adapter.interface';
import { MarketplaceDocument } from '../../schemas/marketplace.schema';
import { ProductDocument } from '../../../product/product-types';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';
import { MagaluHttpClient } from './magalu-http-client';
import { HttpAuthContext } from '../shared/marketplace-http-client';

/**
 * ATENÇÃO: igual ao MercadoLivreProductAdapter, os métodos de ESCRITA aqui
 * (publishProduct) NÃO são o caminho real de publicação — o worker real é
 * microservices/orchestrator/src/workers/magalu/magalu-sync.worker.ts, que
 * fala direto com a API do Magalu. Este adapter serve para LEITURA
 * (getListings/getListingDetail) via MarketplaceIntegrationService.
 * publishProduct existe só para satisfazer o contrato IMarketplaceProductAdapter
 * e não deve ganhar lógica de negócio nova — ela nunca vai rodar.
 */
@Injectable()
export class MagaluProductAdapter implements IMarketplaceProductAdapter, OnModuleInit {
  private readonly logger = new Logger(MagaluProductAdapter.name);
  private name = 'Magalu';

  constructor(
    private readonly registry: MarketplaceAdapterRegistry,
    private readonly http: MagaluHttpClient,
  ) {}

  onModuleInit() {
    this.registry.registerProductAdapter(this.name, this);
  }

  private ctx(context: string, domain?: string): HttpAuthContext {
    return { context, domain };
  }

  async getListings(params: any): Promise<any[]> {
    const data = await this.http.get<any>('/seller/v1/portfolios/skus', this.ctx('getListings'));
    const items: any[] = Array.isArray(data) ? data : (data?.results ?? data?.items ?? []);
    return items.map((sku: any) => ({
      id: sku.sku,
      title: sku.title,
      status: sku.active === false ? 'inactive' : 'active',
      marketplace: { id: params?.marketplaceId, name: this.name, type: 'magalu', icon: 'store' },
    }));
  }

  async getListingDetail(externalId: string): Promise<any> {
    return this.http.get<any>(`/seller/v1/portfolios/skus/${externalId}`, this.ctx('getListingDetail'));
  }

  async publishProduct(
    _product: ProductDocument,
    _marketplace: MarketplaceDocument,
    _externalId?: string,
  ): Promise<{ success: boolean; externalId?: string; skipped?: boolean; error?: string }> {
    this.logger.warn(
      'publishProduct chamado no MagaluProductAdapter (backend) — este caminho não publica de verdade. ' +
      'A publicação real acontece no orchestrator (magalu-sync.worker.ts) via SyncQueue.',
    );
    return { success: false, skipped: true, error: 'publishProduct não é o caminho real — ver magalu-sync.worker.ts' };
  }
}

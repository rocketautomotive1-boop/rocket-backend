import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IMarketplaceCategoryAdapter } from '../../interfaces/marketplace-category-adapter.interface';
import { MarketplaceAdapterRegistry } from '../../registries/marketplace-adapter.registry';

/**
 * STUB: taxonomia/categoria própria do Magalu ainda não documentada nesta
 * integração (todos os métodos da interface são opcionais — nenhum é
 * implementado por ora). O payload de criação de SKU exige `category.id`
 * (UUID), mas de onde esse UUID vem — endpoint de busca de categoria por
 * título, árvore fixa, ou preenchido manualmente por produto — não foi
 * confirmado. Revisitar quando a doc de categorias for fornecida.
 */
@Injectable()
export class MagaluCategoryAdapter implements IMarketplaceCategoryAdapter, OnModuleInit {
  private readonly logger = new Logger(MagaluCategoryAdapter.name);
  private name = 'Magalu';

  constructor(private readonly registry: MarketplaceAdapterRegistry) {}

  onModuleInit() {
    this.registry.registerCategoryAdapter(this.name, this);
  }

  /** Todos os métodos da interface são opcionais; getCategory ancora o tipo estruturalmente. */
  async getCategory(_categoryId: string): Promise<any> {
    this.logger.warn('getCategory chamado — taxonomia do Magalu ainda não documentada.');
    return undefined;
  }
}

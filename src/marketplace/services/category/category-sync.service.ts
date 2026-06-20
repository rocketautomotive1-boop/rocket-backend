import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceCategoryDocument, MarketplaceCategoryModel } from '../../schemas/marketplace-category.schema';
import { MercadoLivreAdapter } from '../../adapters/mercado-livre/mercado-livre.adapter';
import { ShopeeAdapter } from '../../adapters/shopee/shopee.adapter';
import { MarketplaceAuthService } from '../../auth/services/marketplace-auth.service';
import { CategoryQueryService } from './category-query.service';
import { MarketplaceConfigCacheService, MarketplaceConfig } from '../marketplace-config-cache.service';

@Injectable()
export class CategorySyncService {
  private readonly logger = new Logger(CategorySyncService.name);

  constructor(
    @InjectModel(MarketplaceCategoryModel.name)
    private marketplaceCategoryModel: Model<MarketplaceCategoryDocument>,
    private mercadoLivreAdapter: MercadoLivreAdapter,
    private shopeeAdapter: ShopeeAdapter,
    private marketplaceAuthService: MarketplaceAuthService,
    private categoryQueryService: CategoryQueryService,
    private configCache: MarketplaceConfigCacheService,
  ) { }

  async syncCategories(marketplaceId: string | number | any, parentId?: string): Promise<MarketplaceCategoryDocument[]> {
    this.logger.log(`Sincronizando categorias para marketplace ID ${marketplaceId}`);

    const marketplace = await this.configCache.getById(String(marketplaceId));

    if (!marketplace) {
      throw new Error(`Marketplace ID ${marketplaceId} não encontrado`);
    }

    const token = await this.marketplaceAuthService.ensureValidToken(marketplaceId);

    let categories = [];

    switch (marketplace.name) {
      case 'Mercado Livre':
        categories = await this.syncMercadoLivreCategories(marketplace, parentId);
        break;
      case 'Shopee':
        categories = await this.syncShopeeCategories(marketplace, token, parentId);
        break;
      // Adicionar outros marketplaces conforme necessário
      default:
        throw new Error(`Sincronização de categorias não implementada para ${marketplace.name}`);
    }

    return categories;
  }

  private async syncMercadoLivreCategories(marketplace: MarketplaceConfig, parentId?: string): Promise<MarketplaceCategoryDocument[]> {
    this.logger.log(`Sincronizando categorias do Mercado Livre${parentId ? ` para categoria pai ${parentId}` : ''}`);

    try {
      let categories = [];

      if (parentId) {
        // Se tiver parentId, busca recursivamente todas as subcategorias
        this.logger.log(`Buscando recursivamente todas as subcategorias de ${parentId}`);

        // Primeiro, busca os detalhes da categoria pai para garantir que ela seja salva primeiro
        const parentCategory = await this.mercadoLivreAdapter.categoryAdapter.getCategoryDetails(parentId);

        // Adiciona a categoria pai à lista para garantir que ela seja salva/atualizada primeiro
        categories.push(parentCategory);

        // Depois busca todas as subcategorias recursivamente
        const childCategories = await this.mercadoLivreAdapter.categoryAdapter.getAllChildCategories(parentId);
        categories = [...categories, ...childCategories];
      } else {
        // Se não tiver parentId, busca apenas as categorias raiz
        categories = await this.mercadoLivreAdapter.getCategories();

        // Para cada categoria raiz, busca detalhes completos
        const rootCategoriesWithDetails = [];
        for (const rootCategory of categories) {
          const details = await this.mercadoLivreAdapter.categoryAdapter.getCategoryDetails(rootCategory.id);
          rootCategoriesWithDetails.push(details);
        }
        categories = rootCategoriesWithDetails;
      }

      this.logger.log(`Total de ${categories.length} categorias encontradas para sincronização`);

      // Ordenar categorias para garantir que os pais sejam processados antes dos filhos
      // Isso é crucial para manter a hierarquia correta
      categories.sort((a, b) => {
        // Categorias sem pai (raiz) vêm primeiro
        if (!a.parent_id && b.parent_id) return -1;
        if (a.parent_id && !b.parent_id) return 1;

        // Se ambas têm ou não têm pai, ordena por nível (menor nível primeiro)
        return (a.level || 0) - (b.level || 0);
      });

      // Salvar categorias no banco de dados
      const savedCategories = [];
      const processedExternalIds = new Set(); // Para evitar processar a mesma categoria mais de uma vez

      for (const category of categories) {
        // Evitar processar a mesma categoria mais de uma vez
        if (processedExternalIds.has(category.id)) {
          continue;
        }

        processedExternalIds.add(category.id);

        const savedCategory = await this.upsertMercadoLivreCategory(marketplace, category);
        savedCategories.push(savedCategory);

        // Log para depuração da hierarquia
        this.logger.log(`Categoria salva: ID=${savedCategory.id}, externalId=${savedCategory.externalId}, parentId=${savedCategory.parentId}, level=${savedCategory.level}`);
      }

      this.logger.log(`Total de ${savedCategories.length} categorias salvas com sucesso`);
      return savedCategories;
    } catch (error) {
      this.logger.error(`Erro na sincronização de categorias do Mercado Livre: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Persiste uma categoria do Mercado Livre (detalhes completos da API) na coleção interna.
   */
  private async upsertMercadoLivreCategory(
    marketplace: MarketplaceConfig,
    category: any,
  ): Promise<MarketplaceCategoryDocument> {
    const existingCategory = await this.categoryQueryService.findCategoryByExternalId(marketplace.id, category.id);

    const categoryData = {
      externalId: category.id,
      name: category.name,
      parentId: category.parent_id || null,
      path: category.path_from_root?.map((c: { name: string }) => c.name).join(' > ') || null,
      path_from_root: category.path_from_root || undefined,
      level: category.level ?? 0,
      isLeaf: !category.children_categories?.length,
      attributes: category.settings || category.attributes || null,
      marketplace,
    };

    if (existingCategory) {
      this.logger.log(`Atualizando categoria existente: ${category.id} - ${category.name}`);
      await this.marketplaceCategoryModel.updateOne({ _id: existingCategory._id }, categoryData).exec();
      return this.categoryQueryService.findCategoryById(existingCategory.id);
    }

    this.logger.log(`Criando nova categoria: ${category.id} - ${category.name}`);
    const newCategory = new this.marketplaceCategoryModel(categoryData);
    return newCategory.save();
  }

  /**
   * Monta a cadeia do ID informado até a raiz (via parent_id) e persiste em ordem (raiz → folha).
   * Útil quando você já conhece o externalId ML (ex.: MLB270084), sem passar pelo domain_discovery por texto.
   */
  async importCategoryByExternalId(
    marketplaceId: string | number,
    externalCategoryId: string,
  ): Promise<{ chain: MarketplaceCategoryDocument[]; category: MarketplaceCategoryDocument }> {
    this.logger.log(`Importando categoria externa ${externalCategoryId} para marketplace ${marketplaceId}`);

    const marketplace = await this.configCache.getById(String(marketplaceId));
    if (!marketplace) {
      throw new Error(`Marketplace ID ${marketplaceId} não encontrado`);
    }

    if (marketplace.name !== 'Mercado Livre') {
      throw new Error(`Importação por ID externo ainda não implementada para ${marketplace.name}`);
    }

    const token = await this.marketplaceAuthService.ensureValidToken(marketplaceId);
    if (!token?.accessToken) {
      throw new Error('Token de acesso não encontrado para o marketplace');
    }

    const chainRaw: any[] = [];
    let currentId: string | null = externalCategoryId;
    const seen = new Set<string>();

    while (currentId) {
      if (seen.has(currentId)) {
        this.logger.warn(`Ciclo detectado na cadeia de categorias em ${currentId}`);
        break;
      }
      seen.add(currentId);
      const details = await this.mercadoLivreAdapter.categoryAdapter.getCategoryDetails(currentId);
      chainRaw.push(details);
      currentId = details.parent_id || null;
    }

    chainRaw.reverse();

    const saved: MarketplaceCategoryDocument[] = [];
    for (const category of chainRaw) {
      saved.push(await this.upsertMercadoLivreCategory(marketplace, category));
    }

    const leaf = saved[saved.length - 1];
    if (!leaf || leaf.externalId !== externalCategoryId) {
      throw new Error('Falha ao importar categoria: resultado inconsistente');
    }

    return { chain: saved, category: leaf };
  }

  private async syncShopeeCategories(marketplace: MarketplaceConfig, token: any, parentId?: string): Promise<MarketplaceCategoryDocument[]> {
    this.logger.log(`Sincronizando categorias da Shopee${parentId ? ` para categoria pai ${parentId}` : ''}`);

    try {
      // Obter categorias da API da Shopee
      const categories = await this.shopeeAdapter.getCategories(token.accessToken, token.additionalData.shopId, parentId);

      // Salvar categorias no banco de dados
      const savedCategories = [];

      for (const category of categories) {
        const existingCategory = await this.categoryQueryService.findCategoryByExternalId(marketplace.id, category.category_id.toString());

        const categoryData = {
          externalId: category.category_id.toString(),
          name: category.category_name,
          parentId: category.parent_category_id?.toString() || null,
          path: null, // A API da Shopee não fornece o caminho completo
          level: category.level || 0,
          isLeaf: !category.has_children,
          attributes: category.attributes || null,
          marketplace,
        };

        let savedCategory;

        if (existingCategory) {
          // Atualizar categoria existente
          await this.marketplaceCategoryModel.updateOne({ _id: existingCategory._id }, categoryData).exec();
          savedCategory = await this.categoryQueryService.findCategoryById(existingCategory.id);
        } else {
          // Criar nova categoria
          const newCategory = new this.marketplaceCategoryModel(categoryData);
          savedCategory = await newCategory.save();
        }

        savedCategories.push(savedCategory);

        // Processar recursivamente as subcategorias se a categoria tiver filhos
        if (category.has_children) {
          this.logger.log(`Categoria ${category.category_id} da Shopee possui subcategorias. Processando recursivamente...`);

          // Sincronizar subcategorias
          await this.syncShopeeCategoryChildren(marketplace, token, category.category_id.toString());
        }
      }

      return savedCategories;
    } catch (error) {
      this.logger.error(`Erro na sincronização de categorias da Shopee: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Método para sincronizar recursivamente as subcategorias da Shopee
  private async syncShopeeCategoryChildren(marketplace: MarketplaceConfig, token: any, parentId: string): Promise<void> {
    this.logger.log(`Sincronizando subcategorias da Shopee para categoria pai ${parentId}`);

    try {
      // Obter subcategorias da API da Shopee
      const childCategories = await this.shopeeAdapter.getCategories(token.accessToken, token.additionalData.shopId, parentId);

      for (const childCategory of childCategories) {
        const existingCategory = await this.categoryQueryService.findCategoryByExternalId(marketplace.id, childCategory.category_id.toString());

        const categoryData = {
          externalId: childCategory.category_id.toString(),
          name: childCategory.category_name,
          parentId: childCategory.parent_category_id?.toString() || parentId, // Garantir que o parentId seja definido
          path: null, // A API da Shopee não fornece o caminho completo
          level: childCategory.level || 0,
          isLeaf: !childCategory.has_children,
          attributes: childCategory.attributes || null,
          marketplace,
        };

        let savedCategory;

        if (existingCategory) {
          // Atualizar categoria existente
          await this.marketplaceCategoryModel.updateOne({ _id: existingCategory._id }, categoryData).exec();
          savedCategory = await this.categoryQueryService.findCategoryById(existingCategory.id);
        } else {
          // Criar nova categoria
          const newCategory = new this.marketplaceCategoryModel(categoryData);
          savedCategory = await newCategory.save();
        }

        // Processar recursivamente as subcategorias se a categoria tiver filhos
        if (childCategory.has_children) {
          this.logger.log(`Subcategoria ${childCategory.category_id} da Shopee possui subcategorias. Processando recursivamente...`);

          // Chamada recursiva para processar as subcategorias
          await this.syncShopeeCategoryChildren(marketplace, token, childCategory.category_id.toString());
        }
      }
    } catch (error) {
      this.logger.error(`Erro na sincronização de subcategorias da Shopee: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Método para salvar categoria descoberta com dimensões
  async saveDiscoveredCategory(marketplaceId: string | number, category: any): Promise<MarketplaceCategoryDocument> {
    this.logger.log(`Salvando categoria descoberta: ${category.id} - ${category.name}`);

    const marketplace = await this.configCache.getById(String(marketplaceId));
    if (!marketplace) {
      throw new Error(`Marketplace ID ${marketplaceId} não encontrado`);
    }

    const existingCategory = await this.categoryQueryService.findCategoryByExternalId(marketplace.id, category.id);

    const categoryData: any = {
      externalId: category.id,
      name: category.name,
      parentId: category.parent_id || null,
      path: category.path_from_root?.map((c: any) => c.name).join(' > ') || (typeof category.path_from_root === 'string' ? category.path_from_root : null),
      level: category.path_from_root?.length ? category.path_from_root.length - 1 : 0,
      isLeaf: !category.children_categories?.length,
      attributes: category.settings || category.attributes || null,
      marketplace,
    };

    // Upsert Dimensions if present
    if (category.dimensions) {
      categoryData.dimensions = category.dimensions;
    }

    let savedCategory;
    if (existingCategory) {
      await this.marketplaceCategoryModel.updateOne({ _id: existingCategory._id }, categoryData).exec();
      savedCategory = await this.categoryQueryService.findCategoryById(existingCategory.id);
    } else {
      const newCategory = new this.marketplaceCategoryModel(categoryData);
      savedCategory = await newCategory.save();
    }
    return savedCategory;
  }
}

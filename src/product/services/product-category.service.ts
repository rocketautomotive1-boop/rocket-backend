import { Injectable, Logger, Inject, forwardRef, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CategoryModel, CategoryDocument } from '../schemas/category.schema';
import { CreateProductCategoryDto } from '../dto/create-product-category.dto';
import { UpdateProductCategoryDto } from '../dto/update-product-category.dto';
import { UpdateCategoryTreeDto } from '../dto/update-category-tree.dto';

import { CategorySearchService } from '../../search/category-search.service';
import { CategoryDiscoveryService } from '../../search/category-discovery.service';
import { S3Service } from '../../common/s3/s3.service';
import { ProductModel, ProductDocument } from '../schemas/product.schema';
import { AiService } from '../../ai/ai.service';
import { MarketplaceService } from '../../marketplace/services/marketplace.service';
import { CategorySyncService } from '../../marketplace/services/category/category-sync.service';

@Injectable()
export class ProductCategoryService {
  private readonly logger = new Logger(ProductCategoryService.name);

  /** Mesmo texto usado no script `apply_category_refactor.js` para pais estruturais criados pela IA. */
  private readonly structuralParentAiReason = 'Structural Parent created by AI Refactor';

  constructor(
    @InjectModel(CategoryModel.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly categorySearchService: CategorySearchService,
    private readonly s3Service: S3Service,
    private readonly aiService: AiService,
    @Inject(forwardRef(() => CategoryDiscoveryService)) private readonly categoryDiscoveryService: CategoryDiscoveryService,
    private readonly marketplaceService: MarketplaceService,
    private readonly categorySyncService: CategorySyncService,
  ) { }

  private async generateBreadcrumbs(category: CategoryDocument): Promise<string> {
    if (!category.ancestors || category.ancestors.length === 0) return '';

    // Fetch ancestors with projection for name only
    const ancestors = await this.categoryModel.find(
      { _id: { $in: category.ancestors } },
      { name: 1, _id: 1 } // Only need name and _id to sort? 
      // The result of $in is not guaranteed order. We need to resort them by the order in `category.ancestors`.
    ).lean();

    const ancestorMap = new Map(ancestors.map(a => [String(a._id), a.name]));

    // Map original ID array to names
    const names = category.ancestors.map(id => ancestorMap.get(String(id))).filter(Boolean);

    return names.join(' > ');
  }

  async suggestMetadata(tree: string[]) {
    return this.aiService.suggestCategoryMetadata(tree);
  }

  async suggestFromExistingTree(treePath: string[], productContext?: { name?: string; partNumber?: string; description?: string }) {
    // 1. Find the target category by traversing the tree path
    let currentParent: CategoryDocument | null = null;

    for (const segmentName of treePath) {
      const segmentSlug = this.generateSlug(segmentName);
      const query: any = { slug: segmentSlug, active: true };

      if (currentParent) {
        query.parentId = currentParent._id;
      } else {
        query.parentId = null; // Root level
      }

      currentParent = await this.categoryModel.findOne(query);

      if (!currentParent) {
        throw new NotFoundException(`Category "${segmentName}" not found in path [${treePath.join(' > ')}]`);
      }
    }

    // 2. Find all direct children of the target category
    const children = await this.categoryModel.find({
      parentId: currentParent._id,
      active: true
    }).lean().exec();

    if (children.length === 0) {
      return {
        parentCategory: {
          id: currentParent._id,
          name: currentParent.name,
          path: treePath
        },
        suggestions: [],
        message: 'No child categories found'
      };
    }

    // 3. Use AI to rank/filter the existing categories based on product context
    let rankedSuggestions = children.map(cat => ({
      id: cat._id,
      name: cat.name,
      slug: cat.slug,
      examples: cat.examples || [],
      synonyms: cat.synonyms || [],
      usageGuide: cat.usageGuide
    }));

    // If product context is provided, ask AI to rank the categories
    if (productContext && (productContext.name || productContext.partNumber || productContext.description)) {
      try {
        const aiRanking = await this.aiService.rankCategoriesForProduct(
          rankedSuggestions,
          productContext
        );

        if (aiRanking && Array.isArray(aiRanking)) {
          rankedSuggestions = aiRanking;
        }
      } catch (error) {
        // If AI fails, just return the unranked list
        console.warn('AI ranking failed, returning unranked categories:', error.message);
      }
    }

    return {
      parentCategory: {
        id: currentParent._id,
        name: currentParent.name,
        path: treePath
      },
      suggestions: rankedSuggestions,
      totalFound: children.length
    };
  }

  async suggestAndCreateChildren(treePath: string[], autoCreate: boolean = false, searchRefinement?: string) {
    // 1. Find the parent category
    let parentCategory: CategoryDocument | null = null;

    for (const segmentName of treePath) {
      const segmentSlug = this.generateSlug(segmentName);
      const query: any = { slug: segmentSlug, active: true };

      if (parentCategory) {
        query.parentId = parentCategory._id;
      } else {
        query.parentId = null;
      }

      parentCategory = await this.categoryModel.findOne(query);

      if (!parentCategory) {
        throw new NotFoundException(`Category "${segmentName}" not found in path [${treePath.join(' > ')}]`);
      }
    }

    // 2. Ask AI to suggest child categories
    const categoryPath = treePath.join(' > ');
    const aiSuggestions = await this.aiService.suggestChildCategories(categoryPath, searchRefinement);


    if (!autoCreate) {
      return {
        parentCategory: {
          id: parentCategory._id,
          name: parentCategory.name,
          path: treePath
        },
        suggestions: aiSuggestions,
        message: 'Preview mode - set autoCreate: true to create these categories',
        autoCreate: false
      };
    }

    // 3. Create the suggested categories
    const created = [];
    const ancestors = [...(parentCategory.ancestors || []), parentCategory._id as Types.ObjectId];

    for (const suggestion of aiSuggestions) {
      const slug = this.generateSlug(suggestion.name);

      // Check if already exists
      const existing = await this.categoryModel.findOne({
        slug,
        parentId: parentCategory._id
      });

      if (existing) {
        created.push({
          ...suggestion,
          id: existing._id,
          status: 'already_exists'
        });
        continue;
      }

      // Create new category
      const newCategory = new this.categoryModel({
        name: suggestion.name,
        slug,
        parentId: parentCategory._id,
        ancestors,
        active: true,
        examples: suggestion.examples || [],
        synonyms: suggestion.synonyms || [],
        usageGuide: suggestion.usageGuide,
        relevance: suggestion.relevance || 50,
        order: suggestion.order || 0
      });

      await newCategory.save();
      await this.categorySearchService.indexCategory(newCategory);

      created.push({
        ...suggestion,
        id: newCategory._id,
        status: 'created'
      });
    }

    return {
      parentCategory: {
        id: parentCategory._id,
        name: parentCategory.name,
        path: treePath
      },
      created,
      totalCreated: created.filter(c => c.status === 'created').length,
      totalSkipped: created.filter(c => c.status === 'already_exists').length,
      autoCreate: true
    };
  }

  /**
   * 1) Importa a categoria na API do marketplace e persiste em `marketplace_categories`.
   * 2) Mapeia o caminho para a taxonomia Rocket via IA (`mapMarketplaceCategoryToInternal`).
   * 3) Cria/atualiza a árvore em `categories`, com pais estruturais marcados com
   *    aiReason "Structural Parent created by AI Refactor" e a folha com o reasoning da IA.
   * 4) Associa `marketplaceMappings` na categoria interna folha.
   */
  async importMarketplaceExternalCategoryWithAiRefactor(
    marketplaceTag: string,
    externalCategoryId: string,
  ): Promise<{
    marketplaceTag: string;
    marketplaceId: Types.ObjectId;
    marketplacePath: string;
    marketplaceCategoryChain: unknown[];
    marketplaceLeaf: { name: string; externalId: string; path?: string };
    aiMapping: Awaited<ReturnType<AiService['mapMarketplaceCategoryToInternal']>>;
    internalCategory: CategoryDocument;
    createdPath: { name: string; id: string; status: 'created' | 'existing' }[];
  }> {
    const marketplace = await this.marketplaceService.findByTag(marketplaceTag);
    if (!marketplace) {
      throw new NotFoundException(`Marketplace com tag "${marketplaceTag}" não encontrado`);
    }

    const { chain, category: mlLeaf } = await this.categorySyncService.importCategoryByExternalId(
      marketplace._id.toString(),
      externalCategoryId,
    );

    const marketplacePath =
      mlLeaf.path ||
      (mlLeaf.path_from_root?.length
        ? mlLeaf.path_from_root.map((p: { name: string }) => p.name).join(' > ')
        : mlLeaf.name);

    const allCategories = await this.categoryModel
      .find({ active: true })
      .populate('ancestors')
      .select('name ancestors')
      .limit(100)
      .lean();

    const treeContext = allCategories.map(cat => {
      const ancestors = (cat.ancestors as any[]) || [];
      const path = [...ancestors.map(a => a.name), cat.name].join(' > ');
      return { name: cat.name, path };
    });

    const aiMapping = await this.aiService.mapMarketplaceCategoryToInternal(marketplacePath, treeContext);

    if (!aiMapping.suggestedTree?.length) {
      throw new BadRequestException('A IA não retornou uma árvore de categorias válida (suggestedTree vazio).');
    }

    const leafAiReason = aiMapping.reasoning?.trim() || 'Mapeamento a partir da categoria do marketplace';

    const { leaf, createdPath } = await this.ensureRocketCategoryTreeFromAiSuggestedTree(
      aiMapping.suggestedTree,
      leafAiReason,
    );

    await this.addMarketplaceMapping(leaf._id.toString(), {
      marketplaceId: marketplace._id.toString(),
      externalId: externalCategoryId,
      externalName: mlLeaf.name,
      path: marketplacePath,
    });

    const refreshed = await this.categoryModel.findById(leaf._id).exec();

    return {
      marketplaceTag,
      marketplaceId: marketplace._id as Types.ObjectId,
      marketplacePath,
      marketplaceCategoryChain: chain as unknown[],
      marketplaceLeaf: {
        name: mlLeaf.name,
        externalId: mlLeaf.externalId,
        path: mlLeaf.path,
      },
      aiMapping,
      internalCategory: refreshed || leaf,
      createdPath,
    };
  }

  /**
   * Garante uma categoria interna para um `externalCategoryId` (ex.: "MLB264201"):
   * - Se já existe mapping (`marketplaceMappings.externalId`), retorna o id (IDEMPOTENTE,
   *   NÃO chama a IA).
   * - Senão, importa a categoria do marketplace e mapeia via IA
   *   (importMarketplaceExternalCategoryWithAiRefactor), retornando o id criado.
   *
   * Robusto: valida entrada, é idempotente, e isola falhas (ML/IA/timeout) num erro
   * estruturado — NUNCA lança para fora sem contexto. Usado pelo auto-save de
   * categoria do frontend quando o discovery traz o MLB mas não há categoria mapeada.
   */
  async ensureCategoryFromMl(
    marketplaceTag: string,
    externalCategoryId: string,
  ): Promise<{
    categoryId: string | null;
    status: 'existing' | 'created' | 'failed';
    error?: string;
  }> {
    const tag = (marketplaceTag || '').trim();
    const ext = (externalCategoryId || '').trim();

    if (!tag) {
      return { categoryId: null, status: 'failed', error: 'marketplaceTag é obrigatório.' };
    }
    if (!/^MLB\d+$/i.test(ext)) {
      // Só ML por ora; o id de categoria do ML é "MLB" + dígitos (sem prefixo MLBU de catálogo).
      return { categoryId: null, status: 'failed', error: `externalCategoryId inválido para ML: "${ext}".` };
    }

    // 1) Idempotência: já mapeado? Retorna sem tocar na IA.
    try {
      const existing = await this.categoryModel
        .findOne({ 'marketplaceMappings.externalId': ext, active: true })
        .select('_id')
        .lean()
        .exec();
      if (existing) {
        return { categoryId: String((existing as any)._id), status: 'existing' };
      }
    } catch (e: any) {
      this.logger.warn(`ensureCategoryFromMl lookup failed for ${ext}: ${e?.message}`);
      // segue para tentar criar — o lookup falho não deve impedir a criação
    }

    // 2) Não existe → importa + mapeia via IA. Isola qualquer falha.
    try {
      const result = await this.importMarketplaceExternalCategoryWithAiRefactor(tag, ext);
      const id = (result?.internalCategory as any)?._id;
      if (!id) {
        return { categoryId: null, status: 'failed', error: 'Import via IA não retornou categoria.' };
      }
      this.logger.log(`ensureCategoryFromMl created category ${id} for ${tag}/${ext}`);
      return { categoryId: String(id), status: 'created' };
    } catch (e: any) {
      const msg = e?.message ?? 'Falha ao importar/mapear a categoria via IA.';
      this.logger.error(`ensureCategoryFromMl create failed for ${tag}/${ext}: ${msg}`);
      return { categoryId: null, status: 'failed', error: msg };
    }
  }

  /**
   * Percorre suggestedTree; nós intermediários novos recebem aiReason de pai estrutural;
   * a folha recebe leafAiReason.
   */
  private async ensureRocketCategoryTreeFromAiSuggestedTree(
    suggestedTree: string[],
    leafAiReason: string,
  ): Promise<{
    leaf: CategoryDocument;
    createdPath: { name: string; id: string; status: 'created' | 'existing' }[];
  }> {
    const createdPath: { name: string; id: string; status: 'created' | 'existing' }[] = [];
    let currentParent: CategoryDocument | null = null;

    for (let i = 0; i < suggestedTree.length; i++) {
      const segmentName = suggestedTree[i];
      const isStructural = i < suggestedTree.length - 1;
      const segmentSlug = this.generateSlug(segmentName);
      const currentParentId = currentParent ? currentParent._id : null;

      let segment = await this.categoryModel.findOne({
        slug: segmentSlug,
        parentId: currentParentId,
      });

      if (!segment) {
        let finalSlug = segmentSlug;
        let counter = 1;
        while (await this.categoryModel.findOne({ slug: finalSlug })) {
          const raceCheck = await this.categoryModel.findOne({ slug: finalSlug });
          if (
            String(raceCheck.parentId || null) === String(currentParentId || null) &&
            raceCheck.name === segmentName
          ) {
            segment = raceCheck;
            break;
          }
          finalSlug = `${segmentSlug}-${counter}`;
          counter++;
        }

        if (!segment) {
          const ancestors = currentParent
            ? [...(currentParent.ancestors || []), currentParent._id as Types.ObjectId]
            : [];
          segment = new this.categoryModel({
            name: segmentName,
            slug: finalSlug,
            parentId: currentParentId || undefined,
            ancestors,
            active: true,
            aiReason: isStructural ? this.structuralParentAiReason : leafAiReason,
          });
          await segment.save();
          await this.categorySearchService.indexCategory(segment);
          createdPath.push({ name: segment.name, id: segment._id.toString(), status: 'created' });
        } else {
          createdPath.push({ name: segment.name, id: segment._id.toString(), status: 'existing' });
        }
      } else {
        createdPath.push({ name: segment.name, id: segment._id.toString(), status: 'existing' });
      }

      currentParent = segment;
    }

    if (!currentParent) {
      throw new BadRequestException('Árvore de categorias inválida após resolução de segmentos');
    }

    return { leaf: currentParent, createdPath };
  }

  async mapFromMarketplace(marketplacePath: string, autoCreate: boolean = false) {
    // 1. Get existing category tree for context
    const allCategories = await this.categoryModel
      .find({ active: true })
      .populate('ancestors')
      .select('name ancestors')
      .limit(100) // Limit for performance
      .lean();

    // Build context with full paths
    const treeContext = allCategories.map(cat => {
      const ancestors = (cat.ancestors as any[]) || [];
      const path = [...ancestors.map(a => a.name), cat.name].join(' > ');
      return {
        name: cat.name,
        path
      };
    });

    // 2. Ask AI to map marketplace path to Rocket structure
    const aiMapping = await this.aiService.mapMarketplaceCategoryToInternal(
      marketplacePath,
      treeContext
    );

    if (!autoCreate) {
      return {
        marketplacePath,
        mapping: aiMapping,
        message: 'Preview mode - set autoCreate: true to create this category tree',
        autoCreate: false
      };
    }

    // 3. Create the suggested category tree
    const { suggestedTree } = aiMapping;
    let currentParent: CategoryDocument | null = null;
    const createdPath: { name: string; id: string; status: 'created' | 'existing' }[] = [];

    for (const segmentName of suggestedTree) {
      const segmentSlug = this.generateSlug(segmentName);
      const query: any = { slug: segmentSlug, active: true };

      if (currentParent) {
        query.parentId = currentParent._id;
      } else {
        query.parentId = null;
      }

      let segment = await this.categoryModel.findOne(query);

      if (segment) {
        createdPath.push({
          name: segment.name,
          id: segment._id.toString(),
          status: 'existing'
        });
      } else {
        // Create new category
        const ancestors = currentParent
          ? [...(currentParent.ancestors || []), currentParent._id as Types.ObjectId]
          : [];

        segment = new this.categoryModel({
          name: segmentName,
          slug: segmentSlug,
          parentId: currentParent ? currentParent._id : undefined,
          ancestors,
          active: true
        });

        await segment.save();
        await this.categorySearchService.indexCategory(segment);

        createdPath.push({
          name: segment.name,
          id: segment._id.toString(),
          status: 'created'
        });
      }

      currentParent = segment;
    }

    return {
      marketplacePath,
      mapping: aiMapping,
      createdPath,
      finalCategoryId: currentParent?._id.toString(),
      totalCreated: createdPath.filter(p => p.status === 'created').length,
      totalExisting: createdPath.filter(p => p.status === 'existing').length,
      autoCreate: true
    };
  }

  async findAll(): Promise<CategoryModel[]> {
    return this.categoryModel.find({ active: true }).sort({ ancestors: 1, order: 1, name: 1 }).exec();
  }

  async findOne(id: string): Promise<CategoryModel> {
    return this.categoryModel.findById(id).exec();
  }

  async findBySlug(slug: string): Promise<CategoryModel> {
    const category = await this.categoryModel.findOne({ slug }).populate('ancestors').exec();
    if (!category) {
      throw new NotFoundException(`Category with slug ${slug} not found`);
    }
    return category;
  }

  async addMarketplaceMapping(
    categoryId: string,
    mapping: {
      marketplaceId: string;
      externalId: string;
      externalName: string;
      path: string;
    }
  ) {
    const category = await this.categoryModel.findById(categoryId);
    if (!category) {
      throw new NotFoundException(`Category ${categoryId} not found`);
    }

    // Ensure marketplaceMappings array exists
    if (!category.marketplaceMappings) {
      category.marketplaceMappings = [];
    }

    // Check if mapping already exists
    const existingIndex = category.marketplaceMappings.findIndex(
      m => String(m.marketplaceId) === String(mapping.marketplaceId) && m.externalId === mapping.externalId
    );

    if (existingIndex > -1) {
      // Update existing mapping
      category.marketplaceMappings[existingIndex] = {
        ...category.marketplaceMappings[existingIndex],
        externalName: mapping.externalName,
        path: mapping.path
      };
      this.logger.log(`Updated existing marketplace mapping for category ${category.name}`);
    } else {
      // Add new mapping
      category.marketplaceMappings.push({
        marketplaceId: new Types.ObjectId(mapping.marketplaceId),
        externalId: mapping.externalId,
        externalName: mapping.externalName,
        path: mapping.path,
        attributeMappings: {}
      } as any);
      this.logger.log(`Added new marketplace mapping for category ${category.name}`);
    }

    await category.save();

    // Reindex category with updated mappings
    const breadcrumbs = await this.generateBreadcrumbs(category);
    await this.categorySearchService.indexCategory(category, breadcrumbs);

    return category;
  }

  async findByMarketplaceMapping(marketplaceId: string, externalId: string): Promise<CategoryModel | null> {
    return this.categoryModel.findOne({
      marketplaceMappings: {
        $elemMatch: {
          marketplaceId: new Types.ObjectId(marketplaceId),
          externalId: externalId
        }
      }
    }).exec();
  }

  async findOneByMappingId(mappingId: string): Promise<CategoryModel | null> {
    return this.categoryModel.findOne({
      "marketplaceMappings._id": new Types.ObjectId(mappingId)
    }).exec();
  }

  async findByMarketplace(marketplaceId: string): Promise<CategoryModel[]> {
    // Find all categories that have ANY mapping for this marketplace
    return this.categoryModel.find({
      "marketplaceMappings.marketplaceId": new Types.ObjectId(marketplaceId)
    }).exec();
  }

  async getTree(): Promise<any[]> {
    const categories = await this.categoryModel.find({ active: true }).sort({ ancestors: 1, name: 1 }).lean().exec();
    return this.buildTree(categories);
  }

  private buildTree(categories: any[], parentId: string = null): any[] {
    return categories
      .filter(cat => (cat.parentId ? cat.parentId.toString() : null) === (parentId ? parentId.toString() : null))
      .map(cat => ({
        ...cat,
        children: this.buildTree(categories, cat._id)
      }));
  }

  async getDebugCounts() {
    try {
      const counts = await this.productModel.aggregate([
        { $match: { active: true, category: { $ne: null } } },
        { $group: { _id: "$category", count: { $sum: 1 } } }
      ]).exec();

      const targetId = '698e23c0a83c36bf67b0d069';
      const specific = counts.find(c => c._id && c._id.toString() === targetId);

      const catDoc = await this.categoryModel.findById(targetId).exec();

      return {
        message: "Specific Check Result",
        targetId,
        foundInAggregation: !!specific,
        aggregationCount: specific ? specific.count : 0,
        dbDocument: catDoc ? { id: catDoc._id, name: catDoc.name, productCount: catDoc.productCount } : 'NOT FOUND IN DB'
      };
    } catch (e) {
      this.logger.error(`Error in getDebugCounts: ${e.message}`, e.stack);
      throw e;
    }
  }

  async create(createProductCategoryDto: CreateProductCategoryDto): Promise<CategoryModel> {
    const { parentId, name, suggestedTree, ...rest } = createProductCategoryDto;

    // If suggestedTree is provided, use it to determine the hierarchy
    let finalParentId = parentId;
    let ancestors: Types.ObjectId[] = [];

    if (suggestedTree && suggestedTree.length > 0) {
      // Build the tree structure from suggestedTree
      let currentParent: CategoryDocument | null = null;

      // Process all items except the last one (which is the category being created)
      const pathToCreate = suggestedTree.slice(0, -1);

      for (const segmentName of pathToCreate) {
        const segmentSlug = this.generateSlug(segmentName);
        const query: any = { slug: segmentSlug, active: true };

        if (currentParent) {
          query.parentId = currentParent._id;
        } else {
          query.parentId = null;
        }

        let segment = await this.categoryModel.findOne(query);

        if (!segment) {
          // Create intermediate category
          const parentAncestors = currentParent ? [...(currentParent.ancestors || []), currentParent._id as Types.ObjectId] : [];
          segment = new this.categoryModel({
            name: segmentName,
            slug: segmentSlug,
            parentId: currentParent ? currentParent._id : undefined,
            ancestors: parentAncestors,
            active: true
          });
          await segment.save();
          await this.categorySearchService.indexCategory(segment);
        }

        currentParent = segment;
      }

      if (currentParent) {
        finalParentId = currentParent._id.toString();
        ancestors = [...(currentParent.ancestors || []), currentParent._id as Types.ObjectId];
      }
    } else if (finalParentId) {
      // Traditional parentId approach
      const parent = await this.categoryModel.findById(finalParentId);
      if (!parent) {
        throw new NotFoundException(`Parent category ${finalParentId} not found`);
      }
      ancestors = [...parent.ancestors, parent._id as Types.ObjectId];
    }

    const slug = this.generateSlug(name);

    // Check for existing slug to ensure uniqueness
    const existing = await this.categoryModel.findOne({ slug, parentId: finalParentId });
    if (existing) {
      throw new Error(`Category with slug "${slug}" already exists under this parent`);
    }

    const createdCategory = new this.categoryModel({
      ...rest,
      name,
      slug,
      parentId: finalParentId ? new Types.ObjectId(finalParentId) : undefined,
      ancestors
    });
    const saved = await createdCategory.save();
    const breadcrumbs = await this.generateBreadcrumbs(saved);
    await this.categorySearchService.indexCategory(saved, breadcrumbs);
    return saved;
  }

  async updateProductCounts() {
    this.logger.log('Updating product counts per category (optimized)...');

    try {
      // 1. Aggregate counts from ProductModel (Only Active Products)
      const counts = await this.productModel.aggregate([
        { $match: { active: true, category: { $ne: null } } },
        { $group: { _id: "$category", count: { $sum: 1 } } }
      ]).exec();

      // Convert to Map for easy lookup: ID -> Count
      const newCountsMap = new Map<string, number>();
      counts.forEach(c => {
        if (c._id) newCountsMap.set(c._id.toString(), c.count);
      });

      // 2. Fetch all existing categories (projection: productCount, name, ancestors)
      // We need ancestors to fully re-index if needed (though indexCategory fetches if missing)
      // Fetching minimal fields to detect change.
      const allCategories = await this.categoryModel.find({}, 'productCount name').exec();

      const bulkOps = [];
      const categoriesToReindex: CategoryDocument[] = [];

      // 3. Compare and find changes
      for (const cat of allCategories) {
        const catId = cat._id.toString();
        const currentCount = cat.productCount || 0;
        const newCount = newCountsMap.get(catId) || 0;

        if (currentCount !== newCount) {
          // Add to Bulk Write
          bulkOps.push({
            updateOne: {
              filter: { _id: cat._id },
              update: { $set: { productCount: newCount } }
            }
          });

          // Update local doc to reflect new count for indexing
          cat.productCount = newCount;
          categoriesToReindex.push(cat);
        }
      }

      if (bulkOps.length > 0) {
        await this.categoryModel.bulkWrite(bulkOps);
        this.logger.log(`Updated ${bulkOps.length} categories in MongoDB.`);
      } else {
        this.logger.log('No category counts changed.');
      }

      // 4. Re-index affected categories in Discovery Service
      if (categoriesToReindex.length > 0) {
        this.logger.log(`Re-indexing ${categoriesToReindex.length} categories in Discovery...`);

        // Process sequentially to avoid overwhelming ES if many changes, 
        // or Promise.all if small number. Assuming small number typical.
        await Promise.all(categoriesToReindex.map(cat =>
          this.categoryDiscoveryService.indexCategory(cat)
        ));

        this.logger.log('Re-indexing complete.');
      }

      return {
        updatedCategories: bulkOps.length,
        reindexedCategories: categoriesToReindex.length
      };

    } catch (e) {
      this.logger.error(`Failed to update product counts: ${e.message}`, e.stack);
      // Don't throw to prevent blocking the main flow
      return { error: e.message };
    }
  }

  async createOrReturnExisting(createProductCategoryDto: CreateProductCategoryDto): Promise<CategoryModel> {
    const { parentId, name, suggestedTree, ...rest } = createProductCategoryDto;

    // If suggestedTree is provided, use it to determine the hierarchy
    let finalParentId = parentId ? new Types.ObjectId(parentId) : null;
    let ancestors: Types.ObjectId[] = [];

    if (suggestedTree && suggestedTree.length > 0) {
      // Build the tree structure from suggestedTree
      let currentParent: CategoryDocument | null = null;

      // Process all items except the last one (which is the category being created)
      const pathToCreate = suggestedTree.slice(0, -1);

      for (const segmentName of pathToCreate) {
        const segmentSlug = this.generateSlug(segmentName);

        // Find by Slug Global first, then check parent? 
        // Or find strictly by structure.
        // Let's stick to strict structure for the path
        const currentParentId = currentParent ? currentParent._id : null;

        let segment = await this.categoryModel.findOne({
          slug: segmentSlug,
          parentId: currentParentId
        });

        if (!segment) {
          // If strictly valid parent-child not found, check if slug exists elsewhere globally (collision)
          // If collision, we create a new one with suffixed slug.
          let finalSegmentSlug = segmentSlug;
          let counter = 1;

          while (await this.categoryModel.findOne({ slug: finalSegmentSlug })) {
            // Check if it happens to be the one we want (race condition?)
            const raceCheck = await this.categoryModel.findOne({ slug: finalSegmentSlug });
            if (String(raceCheck.parentId || null) === String(currentParentId || null)) {
              segment = raceCheck;
              break;
            }
            finalSegmentSlug = `${segmentSlug}-${counter}`;
            counter++;
          }

          if (!segment) {
            // Create intermediate category
            const parentAncestors = currentParent ? [...(currentParent.ancestors || []), currentParent._id as Types.ObjectId] : [];
            segment = new this.categoryModel({
              name: segmentName,
              slug: finalSegmentSlug,
              parentId: currentParent ? currentParent._id : undefined,
              ancestors: parentAncestors,
              active: true
            });
            await segment.save();
            await this.categorySearchService.indexCategory(segment);
          }
        }

        currentParent = segment;
      }

      if (currentParent) {
        finalParentId = currentParent._id as any; // Cast to ObjectId
        ancestors = [...(currentParent.ancestors || []), currentParent._id as Types.ObjectId];
      }
    } else if (finalParentId) {
      // Traditional parentId approach
      const parent = await this.categoryModel.findById(finalParentId);
      if (!parent) {
        throw new NotFoundException(`Parent category ${finalParentId} not found`);
      }
      ancestors = [...parent.ancestors, parent._id as Types.ObjectId];
    }

    const slug = this.generateSlug(name);

    // 1. Check for EXACT match (same slug, same parent)
    const existingExact = await this.categoryModel.findOne({
      slug,
      parentId: finalParentId
    });

    if (existingExact) {
      this.logger.log(`Category with slug "${slug}" already exists under parent ${finalParentId}, returning existing.`);
      return existingExact;
    }

    // 2. Resolve Slug Collision (Global Uniqueness)
    // If we reach here, we must create a NEW category. But the slug might be taken globally.
    let finalSlug = slug;
    let counter = 1;

    while (await this.categoryModel.findOne({ slug: finalSlug })) {
      // Double check exact match again in loop? Unlikely needed if we checked logic above.
      // Just generate unique slug.
      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    const createdCategory = new this.categoryModel({
      ...rest,
      name,
      slug: finalSlug,
      parentId: finalParentId || undefined,
      ancestors
    });
    const saved = await createdCategory.save();
    const breadcrumbs = await this.generateBreadcrumbs(saved);
    await this.categorySearchService.indexCategory(saved, breadcrumbs);
    return saved;
  }


  async update(id: string, updateProductCategoryDto: UpdateProductCategoryDto): Promise<any> {
    const category = await this.categoryModel.findById(id);
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    const { parentId, name, ...rest } = updateProductCategoryDto;
    let updateData: any = { ...rest };

    if (name && name !== category.name) {
      updateData.name = name;
      updateData.slug = this.generateSlug(name);
    }

    // Check if moving (changing parent)
    if (parentId !== undefined && String(parentId) !== String(category.parentId)) {
      let newAncestors: Types.ObjectId[] = [];
      if (parentId) {
        const newParent = await this.categoryModel.findById(parentId);
        if (!newParent) {
          throw new NotFoundException(`Parent category ${parentId} not found`);
        }
        // Prevent circular reference
        if (String(newParent._id) === String(id) || newParent.ancestors.map(String).includes(String(id))) {
          throw new Error("Cannot move category into its own descendant");
        }
        newAncestors = [...newParent.ancestors, newParent._id as Types.ObjectId];
      }

      updateData.parentId = parentId ? new Types.ObjectId(parentId) : undefined;
      updateData.ancestors = newAncestors;

      // Update descendants
      // 1. Find all descendants
      const descendants = await this.categoryModel.find({ ancestors: category._id });

      for (const descendant of descendants) {
        // Calculate new ancestors for descendant
        // Old Ancestors: [Root, OldParent, CurrentCategory, Child ...]
        // New Ancestors: [...NewAncestors, CurrentCategory, Child ...]
        // Actually simpler: 
        // We know the "path" from CurrentCategory to Descendant remains same relative to CurrentCategory.
        // The prefix changed.

        // Find index of CurrentCategory in descendant's ancestors
        const idx = descendant.ancestors.findIndex(a => String(a) === String(category._id));
        const relativePath = descendant.ancestors.slice(idx + 1); // Path after CurrentCategory

        const descendantNewAncestors = [...newAncestors, category._id as Types.ObjectId, ...relativePath];

        await this.categoryModel.updateOne({ _id: descendant._id }, { ancestors: descendantNewAncestors });

        // Sync descendant to ES
        const updatedDescendant = await this.categoryModel.findById(descendant._id);
        if (updatedDescendant) {
          await this.categorySearchService.indexCategory(updatedDescendant);
        }
      }
    }

    const result = await this.categoryModel.updateOne({ _id: id }, { $set: updateData });

    // Sync to ES
    const updatedCategory = await this.categoryModel.findById(id);
    if (updatedCategory) {
      const breadcrumbs = await this.generateBreadcrumbs(updatedCategory);
      await this.categorySearchService.indexCategory(updatedCategory, breadcrumbs);
    }

    return { success: true, modifiedCount: result.modifiedCount };
  }

  async updateTreeAndMetadata(id: string, dto: UpdateCategoryTreeDto): Promise<any> {
    const category = await this.categoryModel.findById(id);
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    // 1. Update Metadata
    const updateData: any = {};
    if (dto.synonyms) updateData.synonyms = dto.synonyms;
    if (dto.examples) updateData.examples = dto.examples;
    if (dto.usageGuide) updateData.usageGuide = dto.usageGuide;
    if (dto.relevance !== undefined) updateData.relevance = dto.relevance;

    // 2. Determine Path for Tree Update
    const path = dto.path || dto.suggestedTree;

    // If no path, just update metadata.
    if (!path || path.length === 0) {
      if (Object.keys(updateData).length > 0) {
        await this.categoryModel.updateOne({ _id: id }, { $set: updateData });
        const updated = await this.categoryModel.findById(id);
        const breadcrumbs = await this.generateBreadcrumbs(updated);
        await this.categorySearchService.indexCategory(updated, breadcrumbs);
        return updated;
      }
      return category; // Nothing to update
    }

    // --- Tree Update Logic ---
    // If we have a path, we must verify if it effectively changes the parent.
    // Logic from previous updateByPath... with updateData merged.

    // 0. Find or Create path components ...
    // Note: The logic below assumes we move the category "category" to be the child of the LAST item in "path" (excluding itself if present?)
    // Actually the logic provided in existing code (Step 1234) seemed to rebuild the tree logic.
    // I will adapt the existing logic.

    const newName = path[path.length - 1]; // The name of THIS category (or should we rename it?)
    // Usually "path" implies the full hierarchy including the node itself.

    // Check if name changed
    if (category.name !== newName) {
      updateData.name = newName;
      updateData.slug = this.generateSlug(newName); // Regerating slug might break URLs but requested 'fix'
    }

    // Find Parent
    let parentId: Types.ObjectId | null = null;
    let newAncestors: Types.ObjectId[] = [];

    if (path.length > 1) {
      // We need to resolve the parent. 
      // Logic: Find the parent by path. If not exist, maybe create? 
      // For now, assuming parent MUST exist or we find best match? 
      // Existing logic (implied) was:
      // "Find or Create Path" is complex. 
      // Let's assume we search for the parent by name/slug?
      // But names are not unique globally, only siblings.

      // Optimization: Find parent by name?
      // Risky. 
      // If this is an AI suggestion, the path might contain new categories.
      // Implementing a "Start from Root and find/create" loop:

      let currentParent: CategoryDocument | null = null;
      const resolvedAncestors: Types.ObjectId[] = [];

      for (let i = 0; i < path.length - 1; i++) {
        const segmentName = path[i];
        const segmentSlug = this.generateSlug(segmentName);

        // Search for child of currentParent with this slug
        const query: any = { slug: segmentSlug };
        if (currentParent) {
          query.parentId = currentParent._id;
        } else {
          query.parentId = null; // Root
        }

        let segment = await this.categoryModel.findOne(query);

        if (!segment) {
          // Create intermediate category?
          // For safety, let's create it if missing (AI suggested it).
          segment = new this.categoryModel({
            name: segmentName,
            slug: segmentSlug,
            parentId: currentParent ? currentParent._id : undefined,
            ancestors: [...resolvedAncestors],
            active: true
          });
          await segment.save();
          await this.categorySearchService.indexCategory(segment);
        }

        currentParent = segment;
        resolvedAncestors.push(segment._id as Types.ObjectId);
      }

      if (currentParent) {
        parentId = currentParent._id as Types.ObjectId;
        newAncestors = resolvedAncestors;
      }
    } else {
      // If path.length is 1, it means it's a root category.
      parentId = null;
      newAncestors = [];
    }

    // Only update parentId and ancestors if they are different from current
    const currentParentIdString = category.parentId ? String(category.parentId) : null;
    const newParentIdString = parentId ? String(parentId) : null;

    if (newParentIdString !== currentParentIdString || JSON.stringify(newAncestors) !== JSON.stringify(category.ancestors)) {
      updateData.parentId = parentId;
      updateData.ancestors = newAncestors;

      // Update Descendants (Cascade)
      // Only if ancestors/parent changed (which we are overwriting, so yes)

      // Note: If we just moved it, we need to update children's ancestors
      const descendants = await this.categoryModel.find({ ancestors: category._id });

      for (const descendant of descendants) {
        const idx = descendant.ancestors.findIndex(a => String(a) === String(category._id));
        // Path after this category
        const relativePath = idx >= 0 ? descendant.ancestors.slice(idx + 1) : [];

        const descendantNewAncestors = [...newAncestors, category._id as Types.ObjectId, ...relativePath];

        await this.categoryModel.updateOne({ _id: descendant._id }, { ancestors: descendantNewAncestors });

        const updatedDescendant = await this.categoryModel.findById(descendant._id);
        if (updatedDescendant) {
          await this.categorySearchService.indexCategory(updatedDescendant);
        }
      }
    }

    await this.categoryModel.updateOne({ _id: id }, { $set: updateData });

    // Sync to ES
    const updatedCategory = await this.categoryModel.findById(id);
    if (updatedCategory) {
      await this.categorySearchService.indexCategory(updatedCategory);
    }

    return updatedCategory;
  }


  async remove(id: string): Promise<void> {
    // 1. Soft Delete Target
    await this.categoryModel.updateOne({ _id: id }, { active: false });
    await this.categorySearchService.removeCategory(id);

    // 2. Soft Delete Descendants (Cascade)
    const descendants = await this.categoryModel.find({ ancestors: new Types.ObjectId(id) });

    if (descendants.length > 0) {
      const descendantIds = descendants.map(d => d._id);
      await this.categoryModel.updateMany({ _id: { $in: descendantIds } }, { active: false });

      // 3. Remove Descendants from ES
      for (const descendant of descendants) {
        await this.categorySearchService.removeCategory(descendant._id.toString());
      }
    }
  }

  async fixTree(): Promise<string> {
    const categories = await this.categoryModel.find().lean().exec();
    let count = 0;

    // Simpler approach: Iterative updates for now.
    // 1. Ensure Slugs
    for (const cat of categories) {
      if (!cat.slug) {
        await this.categoryModel.updateOne({ _id: cat._id }, { slug: this.generateSlug(cat.name) });
        count++;
      }
    }

    return `Fixed slugs for ${count} categories.`;
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'category-' + Math.random().toString(36).substr(2, 5);
  }

  async syncAllToEs() {
    const categories = await this.categoryModel.find().lean().exec();

    // 1. Get IDs of categories that have at least one product
    // We handle both ObjectId references and embedded documents (snapshots)
    const usedRefs = await this.productModel.distinct('category').exec();
    const usedCategoryIds = new Set<string>();

    for (const ref of usedRefs) {
      if (!ref) continue;
      if (typeof ref === 'object' && '_id' in ref) {
        usedCategoryIds.add(String(ref._id));
      } else {
        usedCategoryIds.add(String(ref));
      }
    }

    // 2. Resolve all "valid" categories (directly used OR ancestors of used)
    const validCategoryIds = new Set<string>();

    // Helper map for quick lookup
    const categoryMap = new Map(categories.map(c => [String(c._id), c]));

    // Mark used categories and their ancestors as valid
    for (const id of usedCategoryIds) {
      let currentId = id;
      while (currentId && !validCategoryIds.has(currentId)) {
        validCategoryIds.add(currentId);
        const cat = categoryMap.get(currentId);
        if (cat && cat.parentId) {
          currentId = String(cat.parentId);
        } else if (cat && cat.ancestors && cat.ancestors.length > 0) {
          // Fallback if parentId is missing but ancestors exist (though parentId is clearer)
          // Actually ancestors array usually contains path. Last element is parent.
          currentId = String(cat.ancestors[cat.ancestors.length - 1]);
        } else {
          currentId = null;
        }
      }
    }

    // Also respect "active" flag from DB? 
    // User asked to "subir somente as que possuem produto". 
    // This implies even if active=true in DB, if no products, don't sync.
    // But if active=false in DB, we definitely don't sync.

    let count = 0;
    let removed = 0;

    for (const cat of categories) {
      const catId = String(cat._id);

      // A category is valid for ES if:
      // 1. It is marked as active in DB (implicitly check logic or explicit)
      // 2. It is in our validCategoryIds set (meaning it has products or children with products)

      const isActiveInDb = cat.active !== false;
      const hasProductsOrChildren = validCategoryIds.has(catId);

      if (isActiveInDb && hasProductsOrChildren) {
        // Need to cast or fetch full doc? 'cat' is from lean() query.
        // generateBreadcrumbs expects Document but only uses ancestors array.
        // But lean object doesn't have methods.
        // And ancestors in lean might be strings or ObjectIds? 
        // Ancestors are defined as Types.ObjectId[] in schema. Lean returns them as ObjectIds.

        // Wait, generateBreadcrumbs uses `this.categoryModel.find`.
        // We can adapt generateBreadcrumbs to work with lean object or ensure we pass what it needs.
        // Since `cat` is lean, we need to be careful.
        // Let's manually reconstruct the breadcrumbs here since we have ALL categories in memory (categoryMap).
        // Optimization: use categoryMap to build breadcrumbs without DB query.

        // Build breadcrumbs from 'cat.ancestors' using 'categoryMap'
        let breadcrumbs = '';
        if (cat.ancestors && cat.ancestors.length > 0) {
          const names = cat.ancestors.map(aId => {
            const a = categoryMap.get(String(aId));
            return a ? a.name : '';
          }).filter(Boolean);
          breadcrumbs = names.join(' > ');
        }

        await this.categorySearchService.indexCategory(cat as any, breadcrumbs);
        count++;
      } else {
        await this.categorySearchService.removeCategory(catId);
        removed++;
      }
    }

    return {
      count,
      removed,
      message: `Synced active categories with products. Indexed: ${count}, Removed: ${removed}`
    };
  }

  async updateByPath(id: string, path: string[]): Promise<CategoryModel> {
    if (!path || path.length === 0) {
      throw new Error("Path cannot be empty");
    }

    const category = await this.categoryModel.findById(id);
    if (!category) throw new NotFoundException("Category not found");

    // 1. Resolve Parent (Path - 1)
    let currentParentId: Types.ObjectId | undefined = undefined;
    const parentAncestors: Types.ObjectId[] = [];

    // Iterate up to the second to last item to build/find structure
    for (let i = 0; i < path.length - 1; i++) {
      const name = path[i];
      const slug = this.generateSlug(name);

      let parent = await this.categoryModel.findOne({
        slug: slug,
        parentId: currentParentId
      });

      if (!parent) {
        // Create intermediate category
        parent = await this.categoryModel.create({
          name: name,
          slug: slug,
          parentId: currentParentId,
          ancestors: [...parentAncestors],
          active: true
        });
        await this.categorySearchService.indexCategory(parent);
      }

      currentParentId = parent._id as Types.ObjectId;
      parentAncestors.push(parent._id as Types.ObjectId);
    }

    // 2. Update Target Category (Last item in path)
    const newName = path[path.length - 1];
    const newSlug = this.generateSlug(newName);

    // Check if we are actually preventing a duplicate at the leaf level
    // (Optional: check if another category with same slug exists under this parent, usually okay to merge or fail?)
    // For now, assume we just update THIS category.

    // 3. Apply Update
    // Reuse existing update method logic to handle subtree moving if needed? 
    // But `update` method logic for ancestry is complex. 
    // Since we computed new parent and ancestors accurately above:

    // We must check if we are moving (changing parent).
    const isMoving = String(category.parentId) !== String(currentParentId);

    if (isMoving) {
      // Validation: Prevent moving into own descendant
      if (currentParentId && (String(currentParentId) === String(id) || parentAncestors.map(String).includes(String(id)))) {
        throw new Error("Cannot move category into its own descendant");
      }
    }

    category.name = newName;
    category.slug = newSlug;
    category.parentId = currentParentId;
    category.ancestors = parentAncestors;
    category.active = true; // Revive if it was soft deleted? Usually yes if we are explicitly setting path.

    await category.save();

    // 4. Update Descendants of THIS category (if any)
    // We moved 'category', so all its children need their ancestors updated.
    // The new ancestor prefix for children is: [...parentAncestors, category._id]

    const newChildrenAncestors = [...parentAncestors, category._id as Types.ObjectId];

    await this.updateDescendantsAncestors(category._id as Types.ObjectId, newChildrenAncestors);

    await this.categorySearchService.indexCategory(category);

    return category;
  }

  private async updateDescendantsAncestors(parentId: Types.ObjectId, newAncestors: Types.ObjectId[]) {
    const descendants = await this.categoryModel.find({ parentId: parentId });
    for (const child of descendants) {
      child.ancestors = newAncestors;
      await child.save();
      await this.categorySearchService.indexCategory(child);

      // Recursively update grand-children
      await this.updateDescendantsAncestors(child._id as Types.ObjectId, [...newAncestors, child._id as Types.ObjectId]);
    }
  }

  async uploadImage(id: string, file: any): Promise<CategoryModel> {
    const category = await this.categoryModel.findById(id);
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    const key = `categories/${category.slug}/${file.originalname}`;
    const url = await this.s3Service.uploadFile(file.buffer, key, file.mimetype);

    category.image = url;
    await category.save();

    await this.categorySearchService.indexCategory(category);
    return category;
  }

  async getEsTree() {
    return this.categorySearchService.getTree();
  }

  async searchCategories(query: string) {
    return this.categorySearchService.searchCategories(query);
  }
}

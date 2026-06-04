import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument, MarketplaceDescriptionTemplateSnapshot } from '../schemas/marketplace.schema';
import { ProductDocument } from '../../product/product-types';
import { MarketplaceTemplateRepository } from './marketplace-template.repository';
import { ProductFieldMapper } from './product-field-mapper.service';
import { TemplateEngine } from './template-engine.service';
import { ProductMovementService } from '../../product/services/product-movement.service';

/**
 * Orchestrator do sistema de templates de descrição.
 *
 * Este serviço NÃO contém lógica de processamento — apenas coordena:
 *   MarketplaceTemplateRepository → busca template no DB
 *   ProductFieldMapper            → converte produto em mapa de placeholders
 *   TemplateEngine                → processa template e retorna descrição final
 *
 * Os métodos de CRUD são wrappers delegados ao Repository para manter
 * compatibilidade com os callers existentes (adapters, controllers).
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  Guia de Correção Futura                                │
 * │  Novo placeholder         → product-field-mapper        │
 * │  Linhas extras / cleanup  → template-engine (cleanup)   │
 * │  Condição não avalia      → template-condition.evaluator│
 * │  Template não encontrado  → marketplace-template.repo   │
 * │  Seção condicional bug    → template-engine (sections)  │
 * │  CRUD de template bug     → marketplace-template.repo   │
 * └─────────────────────────────────────────────────────────┘
 */
@Injectable()
export class MarketplaceDescriptionService {
  private readonly logger = new Logger(MarketplaceDescriptionService.name);

  constructor(
    @InjectModel(MarketplaceModel.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
    private readonly templateRepo: MarketplaceTemplateRepository,
    private readonly fieldMapper: ProductFieldMapper,
    private readonly engine: TemplateEngine,
    @Inject(forwardRef(() => ProductMovementService))
    private readonly productMovementService: ProductMovementService,
  ) {}

  // ── Geração de descrição (core) ───────────────────────────────────────────

  async generateDescription(
    product: ProductDocument,
    marketplaceName: string,
    templateId?: string,
    listingTitle?: string,
  ): Promise<string> {
    const productDomain = (product as any)?.domain as string | undefined;
    const template = templateId
      ? await this.templateRepo.findById(templateId)
      : await this.templateRepo.findDefault(marketplaceName, productDomain);

    if (!template) {
      throw new Error(`Nenhum template padrão encontrado para marketplace "${marketplaceName}"`);
    }

    const rawProduct = typeof (product as any).toObject === 'function'
      ? (product as any).toObject()
      : product;
    const productId = String((rawProduct as any)._id ?? (rawProduct as any).id ?? '');
    let stockSnapshot: { condition: string; situation: string } | null = null;
    if (productId && Types.ObjectId.isValid(productId)) {
      try {
        stockSnapshot = await this.productMovementService.getListingStockSnapshot(productId);
      } catch (e: any) {
        this.logger.warn(`Descrição: snapshot de estoque ignorado: ${e?.message}`);
      }
    }

    const fieldMap = this.fieldMapper.map(product, stockSnapshot);
    // listing.title overrides {produto} so the description body matches the actual ML title
    if (listingTitle) fieldMap['produto'] = listingTitle;

    // Merge fieldMap into conditionContext so conditions can reference
    // generated fields like atributos_count (which don't exist on product)
    const conditionContext = {
      ...rawProduct,
      ...fieldMap,
      ...(stockSnapshot && {
        condition: stockSnapshot.condition,
        situation: stockSnapshot.situation,
      }),
    };

    return this.engine.process(
      template.template,
      (template.sections as any[]) || [],
      fieldMap,
      conditionContext,
    );
  }

  // ── CRUD (delegado ao Repository) ─────────────────────────────────────────

  async createTemplate(
    name: string,
    title: string,
    template: string,
    marketplaceId: string,
    isDefault = false,
    placeholders?: Record<string, any>,
    sections?: Record<string, any>[],
  ): Promise<MarketplaceDescriptionTemplateSnapshot> {
    return this.templateRepo.create(marketplaceId, { name, title, template, isDefault, placeholders, sections });
  }

  async updateTemplate(
    id: string,
    data: Partial<MarketplaceDescriptionTemplateSnapshot>,
  ): Promise<MarketplaceDescriptionTemplateSnapshot> {
    return this.templateRepo.update(id, data);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.templateRepo.delete(id);
  }

  async findTemplateById(id: string): Promise<MarketplaceDescriptionTemplateSnapshot | null> {
    return this.templateRepo.findById(id);
  }

  async findTemplatesByMarketplace(marketplaceName: string): Promise<MarketplaceDescriptionTemplateSnapshot[]> {
    return this.templateRepo.findByMarketplace(marketplaceName);
  }

  async getDefaultTemplateForMarketplace(marketplaceId: string): Promise<MarketplaceDescriptionTemplateSnapshot | null> {
    const marketplace = await this.marketplaceModel.findById(marketplaceId);
    if (!marketplace) return null;
    return marketplace.templates?.find(t => t.isDefault && t.isActive) ?? null;
  }

  async getDefaultTemplateForMarketplaceName(marketplaceName: string): Promise<MarketplaceDescriptionTemplateSnapshot | null> {
    return this.templateRepo.findDefault(marketplaceName);
  }
}

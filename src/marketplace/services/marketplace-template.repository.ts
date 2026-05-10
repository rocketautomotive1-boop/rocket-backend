import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument, MarketplaceDescriptionTemplateSnapshot } from '../schemas/marketplace.schema';

/**
 * Responsabilidade única: acesso ao MongoDB para templates de descrição.
 *
 * Todos os templates vivem como subdocumentos dentro do documento do Marketplace.
 * Esta classe isola completamente esse detalhe de implementação.
 *
 * Para corrigir um bug de busca/persistência de templates → edite apenas este arquivo.
 */
@Injectable()
export class MarketplaceTemplateRepository {
  private readonly logger = new Logger(MarketplaceTemplateRepository.name);

  constructor(
    @InjectModel(MarketplaceModel.name)
    private readonly marketplaceModel: Model<MarketplaceDocument>,
  ) {}

  // ── Consultas ──────────────────────────────────────────────────────────────

  async findDefault(marketplaceName: string): Promise<MarketplaceDescriptionTemplateSnapshot | null> {
    const marketplace = await this.findMarketplaceByName(marketplaceName);
    if (!marketplace) return null;

    const template = marketplace.templates?.find(t => t.isDefault && t.isActive);
    if (!template) {
      this.logger.warn(`Nenhum template padrão ativo encontrado para "${marketplaceName}"`);
      return null;
    }
    return template;
  }

  async findById(id: string): Promise<MarketplaceDescriptionTemplateSnapshot | null> {
    const marketplace = await this.marketplaceModel
      .findOne({ 'templates._id': id }, { 'templates.$': 1, name: 1 })
      .lean();

    return marketplace?.templates?.[0] ?? null;
  }

  async findByMarketplace(marketplaceName: string): Promise<MarketplaceDescriptionTemplateSnapshot[]> {
    const marketplace = await this.findMarketplaceByName(marketplaceName);
    if (!marketplace) return [];
    return (marketplace.templates || []).filter(t => t.isActive);
  }

  // ── Mutações ───────────────────────────────────────────────────────────────

  async create(
    marketplaceId: string,
    data: Partial<MarketplaceDescriptionTemplateSnapshot>,
  ): Promise<MarketplaceDescriptionTemplateSnapshot> {
    const marketplace = await this.marketplaceModel.findById(marketplaceId);
    if (!marketplace) throw new Error(`Marketplace ${marketplaceId} não encontrado`);

    if (data.isDefault) {
      (marketplace.templates || []).forEach(t => { t.isDefault = false; });
    }

    const newTemplate: MarketplaceDescriptionTemplateSnapshot = {
      name: data.name,
      title: data.title,
      template: data.template,
      isActive: data.isActive ?? true,
      isDefault: data.isDefault ?? false,
      placeholders: data.placeholders,
      sections: data.sections,
    };

    if (!marketplace.templates) marketplace.templates = [];
    marketplace.templates.push(newTemplate);
    await marketplace.save();

    return marketplace.templates[marketplace.templates.length - 1];
  }

  async update(
    id: string,
    data: Partial<MarketplaceDescriptionTemplateSnapshot>,
  ): Promise<MarketplaceDescriptionTemplateSnapshot> {
    const marketplace = await this.marketplaceModel.findOne({ 'templates._id': id });
    if (!marketplace) throw new Error(`Template ${id} não encontrado`);

    const idx = marketplace.templates.findIndex((t: any) => t._id.toString() === id);
    if (idx === -1) throw new Error(`Template ${id} não encontrado no marketplace`);

    if (data.isDefault) {
      marketplace.templates.forEach(t => { t.isDefault = false; });
    }

    const tpl = marketplace.templates[idx];
    if (data.name      !== undefined) tpl.name      = data.name;
    if (data.title     !== undefined) tpl.title     = data.title;
    if (data.template  !== undefined) tpl.template  = data.template;
    if (data.isActive  !== undefined) tpl.isActive  = data.isActive;
    if (data.isDefault !== undefined) tpl.isDefault = data.isDefault;
    if (data.placeholders !== undefined) tpl.placeholders = data.placeholders;
    if (data.sections  !== undefined) tpl.sections  = data.sections;

    marketplace.markModified('templates');
    await marketplace.save();

    return marketplace.templates[idx];
  }

  async delete(id: string): Promise<boolean> {
    const marketplace = await this.marketplaceModel.findOne({ 'templates._id': id });
    if (!marketplace) return false;

    marketplace.templates = marketplace.templates.filter((t: any) => t._id.toString() !== id);
    await marketplace.save();
    return true;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async findMarketplaceByName(name: string): Promise<MarketplaceDocument | null> {
    // Try exact name, then case-insensitive name, then tag field
    return (
      (await this.marketplaceModel.findOne({ name })) ??
      (await this.marketplaceModel.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } })) ??
      (await this.marketplaceModel.findOne({ tag: name }))
    );
  }
}

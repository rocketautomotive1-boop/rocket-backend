import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MarketplaceModel, MarketplaceDocument, MarketplaceDescriptionTemplateSnapshot } from '../schemas/marketplace.schema';
import { ProductDocument } from '../../product/product-types';

@Injectable()
export class MarketplaceDescriptionService {
  private readonly logger = new Logger(MarketplaceDescriptionService.name);

  constructor(
    @InjectModel(MarketplaceModel.name)
    private marketplaceModel: Model<MarketplaceDocument>,
  ) { }

  async createTemplate(
    name: string,
    title: string,
    template: string,
    marketplaceId: string,
    isDefault: boolean = false,
    placeholders?: Record<string, any>,
    sections?: Record<string, any>[],
  ): Promise<any> {
    this.logger.log(`Criando template de descrição "${name}" para marketplace ${marketplaceId}`);

    const marketplace = await this.marketplaceModel.findById(marketplaceId);
    if (!marketplace) throw new Error('Marketplace não encontrado');

    const newTemplate: MarketplaceDescriptionTemplateSnapshot = {
      name,
      title,
      template,
      isActive: true,
      isDefault,
      placeholders,
      sections
    };

    // Se este for o template padrão, desmarcar outros templates padrão para este marketplace
    if (isDefault) {
      if (marketplace.templates) {
        marketplace.templates.forEach(t => {
          if (t.isDefault) t.isDefault = false;
        });
      }
    }

    if (!marketplace.templates) marketplace.templates = [];
    marketplace.templates.push(newTemplate);

    await marketplace.save();
    return marketplace.templates[marketplace.templates.length - 1];
  }

  async updateTemplate(
    id: string,
    data: Partial<MarketplaceDescriptionTemplateSnapshot>,
  ): Promise<any> {
    this.logger.log(`Atualizando template de descrição ID ${id}`);

    const marketplace = await this.marketplaceModel.findOne({ 'templates._id': id });
    if (!marketplace) {
      throw new Error(`Template de descrição ID ${id} não encontrado`);
    }

    const templateIndex = marketplace.templates.findIndex((t: any) => t._id.toString() === id);
    if (templateIndex === -1) throw new Error('Template não encontrado no marketplace');

    // Se estiver definindo como padrão, desmarcar outros
    if (data.isDefault) {
      marketplace.templates.forEach(t => {
        if (t.isDefault) t.isDefault = false;
      });
    }

    const currentTemplate = marketplace.templates[templateIndex];
    // Explicit assignment to update the embedded document
    if (data.name !== undefined) currentTemplate.name = data.name;
    if (data.title !== undefined) currentTemplate.title = data.title;
    if (data.template !== undefined) currentTemplate.template = data.template;
    if (data.isActive !== undefined) currentTemplate.isActive = data.isActive;
    if (data.isDefault !== undefined) currentTemplate.isDefault = data.isDefault;
    if (data.placeholders !== undefined) currentTemplate.placeholders = data.placeholders;
    if (data.sections !== undefined) currentTemplate.sections = data.sections;

    // Trigger mongoose save for subdocs
    marketplace.markModified('templates');
    await marketplace.save();

    return marketplace.templates[templateIndex];
  }

  async deleteTemplate(id: string): Promise<boolean> {
    this.logger.log(`Excluindo template de descrição ID ${id}`);

    const marketplace = await this.marketplaceModel.findOne({ 'templates._id': id });
    if (!marketplace) return false;

    marketplace.templates = marketplace.templates.filter((t: any) => t._id.toString() !== id);
    await marketplace.save();
    return true;
  }

  async findTemplateById(id: string): Promise<any> {
    this.logger.log(`Buscando template de descrição por ID ${id}`);

    const marketplace = await this.marketplaceModel.findOne(
      { 'templates._id': id },
      { 'templates.$': 1, name: 1 } // Projection to return only the matching template and marketplace name
    ).lean();

    if (marketplace && marketplace.templates && marketplace.templates.length > 0) {
      const template = marketplace.templates[0];
      return {
        ...template,
        marketplace: { _id: marketplace._id, name: marketplace.name } // Enrich with marketplace info
      };
    }
    return null;
  }

  async findTemplatesByMarketplace(marketplaceName: string): Promise<any[]> {
    this.logger.log(`Buscando templates de descrição para marketplace ${marketplaceName}`);

    const marketplace = await this.marketplaceModel.findOne({ name: marketplaceName });
    if (!marketplace) return [];

    return (marketplace.templates || [])
      .filter(t => t.isActive)
      .map(t => ({ ...t, marketplace: { _id: marketplace._id, name: marketplace.name } }));
  }

  async getDefaultTemplateForMarketplace(marketplaceId: string): Promise<any> {
    const marketplace = await this.marketplaceModel.findById(marketplaceId);
    if (!marketplace) return null;

    let template = marketplace.templates?.find(t => t.isDefault && t.isActive);
    if (template) {
      return { ...template, marketplace: { _id: marketplace._id, name: marketplace.name } };
    }
    return null;
  }

  async getDefaultTemplateForMarketplaceName(marketplaceName: string): Promise<any> {
    console.log(`[MarketplaceDescriptionService] Buscando marketplace pelo nome: "${marketplaceName}"`);
    let marketplace = await this.marketplaceModel.findOne({ name: marketplaceName });

    // Case-insensitive fallback
    if (!marketplace) {
      console.log(`[MarketplaceDescriptionService] Busca exata falhou. Tentando case-insensitive...`);
      marketplace = await this.marketplaceModel.findOne({ name: { $regex: new RegExp(`^${marketplaceName}$`, 'i') } });
    }

    if (!marketplace) {
      console.warn(`[MarketplaceDescriptionService] Marketplace não encontrado no DB para o nome: "${marketplaceName}"`);
      return null;
    }

    console.log(`[MarketplaceDescriptionService] Marketplace encontrado: ${marketplace.name} (ID: ${marketplace._id}). Buscando templates ativos...`);
    if (marketplace.templates) {
      console.log(`[MarketplaceDescriptionService] Templates disponíveis: ${marketplace.templates.length}. Detalhes: ${marketplace.templates.map(t => `${t.name} (Default: ${t.isDefault}, Active: ${t.isActive})`).join(', ')}`);
    } else {
      console.log(`[MarketplaceDescriptionService] NENHUM template definido neste marketplace.`);
    }

    const template = marketplace.templates?.find(t => t.isDefault && t.isActive);
    if (template) {
      console.log(`[MarketplaceDescriptionService] Template padrão encontrado: ${template.name}`);
      return { ...template, marketplace: { _id: marketplace._id, name: marketplace.name } };
    }

    console.warn(`[MarketplaceDescriptionService] Nenhum template padrão ATIVO encontrado.`);
    return null;
  }

  /**
   * Gera uma descrição formatada para um produto usando o template especificado
   */
  async generateDescription(
    product: ProductDocument,
    marketplaceName: string,
    templateId?: string,
    observation?: string,
  ): Promise<string> {
    // Buscar o template (específico ou padrão)
    let template: any;

    if (templateId) {
      template = await this.findTemplateById(templateId);
      if (!template || !template.marketplace || (template.marketplace.name && template.marketplace.name !== marketplaceName)) {
        throw new Error(`Template ID ${templateId} não encontrado ou não pertence ao marketplace ${marketplaceName}`);
      }
    } else {
      template = await this.getDefaultTemplateForMarketplaceName(marketplaceName);
      if (!template) {
        // Fallback: don't error immediately if strict requirement not set, but function signature implies generating string
        // For strictness, stick to Error
        console.warn(`[MarketplaceDescriptionService] Nenhum template padrão encontrado para marketplace ${marketplaceName}`);
        throw new Error(`Nenhum template padrão encontrado para marketplace ${marketplaceName}`);
      }
    }

    // Processar o template substituindo as variáveis
    return this.processTemplate(template, product);
  }

  /**
   * Processa um template substituindo as variáveis pelos valores do produto
   */
  private processTemplate(template: MarketplaceDescriptionTemplateSnapshot, product: ProductDocument): string {
    // Robust access: try property, then _doc (if mongoose element), then toObject
    let processedTemplate = template.template;

    if (!processedTemplate && (template as any)._doc) {
      console.log('[MarketplaceDescriptionService] Acessando template via _doc...');
      processedTemplate = (template as any)._doc.template;
    }

    if (!processedTemplate) {
      processedTemplate = '';
    }

    // DEBUG: Inspect the template object structure
    try {
      const tempObj = (template as any).toObject ? (template as any).toObject() : template;
      const keys = Object.keys(tempObj);
      const docKeys = (template as any)._doc ? Object.keys((template as any)._doc) : [];
      console.log(`[MarketplaceDescriptionService] Template Object Keys: ${keys.join(', ')}`);
      if (docKeys.length > 0) console.log(`[MarketplaceDescriptionService] Template _doc Keys: ${docKeys.join(', ')}`);
    } catch (e) {
      console.log(`[MarketplaceDescriptionService] Error inspecting template object: ${e.message}`);
    }

    // Fallback if template is empty
    if (!processedTemplate || processedTemplate.trim().length === 0) {
      console.warn(`[MarketplaceDescriptionService] Template encontrado mas está vazio. Usando fallback padrão.`);
      processedTemplate = `
{produto}

Marca: {marca}
Código: {codigo}

Descrição:
{descricao_curta}

Características:
Peso: {peso}kg
Dimensões: {comprimento}x{largura}x{altura}cm

Dúvidas? Pergunte abaixo!
        `.trim();
    }

    // Função para capitalizar texto
    const capitalizeText = (text: string): string => {
      if (!text) return '';
      return text
        .split(' ')
        .map(word => {
          if (word.length <= 2) return word;
          if (word[0] === word[0].toUpperCase()) return word;
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(' ');
    };

    // Função para formatar o nome do produto
    const formatProductName = (name: string, partNumber: string): string => {
      const capitalizedName = capitalizeText(name);
      const nameWithPartNumber = `${capitalizedName} ${partNumber || ''}`.trim();

      if (nameWithPartNumber.length <= 60) {
        return nameWithPartNumber;
      }
      return capitalizedName;
    };

    // Substituir variáveis básicas do produto
    processedTemplate = processedTemplate
      .replace(/\{produto\}/g, formatProductName(product.name || '', product.partNumber || ''))
      .replace(/\{marca\}/g, product.brand?.amazonName || product.brand?.name || '')
      .replace(/\{modelo\}/g, product.partNumber || '')
      .replace(/\{descricao_curta\}/g, product.description || '')
      .replace(/\{preco\}/g, product.price ? Number(product.price).toFixed(2) : '0.00')
      .replace(/\{codigo\}/g, product.barcode || product.partNumber || '')
      .replace(/\{peso\}/g, product.weight ? product.weight.toString() : '0')
      .replace(/\{comprimento\}/g, product.dimensions?.length ? product.dimensions.length.toString() : '0')
      .replace(/\{largura\}/g, product.dimensions?.width ? product.dimensions.width.toString() : '0')
      .replace(/\{altura\}/g, product.dimensions?.height ? product.dimensions.height.toString() : '0')
      .replace(/\{categoria\}/g, (product.category as any)?.name || '')
      .replace(/\{garantia\}/g, '')
      .replace(/\{observacao\}/g, '');

    // Processar seções condicionais
    // Robust access: try property, then _doc
    const sections = template.sections || ((template as any)._doc && (template as any)._doc.sections);

    if (sections) {
      console.log(`[MarketplaceDescriptionService] Processando ${sections.length} seções condicionais...`);
      for (const section of sections) {
        if (section.condition && section.content) {
          try {
            const conditionMet = this.evaluateCondition(section.condition, product);
            console.log(`[MarketplaceDescriptionService] Avaliando condição "${section.condition}": ${conditionMet}`);

            if (conditionMet) {
              // Remove tags but keep content
              const sectionContent = section.content
                .replace(/\[[A-Z_]+_SECTION\]\s*/g, '') // Remove opening tag
                .replace(/\[\/[A-Z_]+_SECTION\]\s*/g, ''); // Remove closing tag

              // Replace exact raw content matches in the template
              // We use split/join to replace ALL occurrences if necessary, though usually distinct
              if (processedTemplate.includes(section.content)) {
                processedTemplate = processedTemplate.replace(section.content, sectionContent);
              } else {
                console.warn(`[MarketplaceDescriptionService] Conteúdo da seção não encontrado no template principal. Tags podem sobrar. Content start: ${section.content.substring(0, 20)}...`);
              }
            } else {
              // Remove the entire section content including tags from the template
              processedTemplate = processedTemplate.replace(section.content, '');
            }
          } catch (error) {
            this.logger.error(`Erro ao avaliar condição "${section.condition}": ${error.message}`);
          }
        }
      }
    } else {
      console.log(`[MarketplaceDescriptionService] Nenhuma seção de condicionais encontrada.`);
    }

    // Ultimo recurso: Limpar tags soltas que possam ter sobrado (Cleaning leftover tags)
    processedTemplate = processedTemplate.replace(/\[[A-Z_]+_SECTION\]/g, '').replace(/\[\/[A-Z_]+_SECTION\]/g, '');

    // Processar placeholders personalizados
    if (template.placeholders) {
      for (const [key, value] of Object.entries(template.placeholders)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        processedTemplate = processedTemplate.replace(regex, String(value));
      }
    }

    // Remover linhas vazias duplicadas e espaços extras
    return processedTemplate
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  /**
   * Avalia uma condição simples para seções condicionais
   */
  private evaluateCondition(condition: string, product: ProductDocument): boolean {
    if (condition.includes('>')) {
      const [field, value] = condition.split('>').map(s => s.trim());
      const productValue = this.getProductValue(field, product);
      return productValue > parseFloat(value);
    }

    if (condition.includes('<')) {
      const [field, value] = condition.split('<').map(s => s.trim());
      const productValue = this.getProductValue(field, product);
      return productValue < parseFloat(value);
    }

    if (condition.includes('==')) {
      const [field, value] = condition.split('==').map(s => s.trim());
      const productValue = this.getProductValue(field, product);

      const numValue = Number(value);
      const numProductValue = Number(productValue);

      if (!isNaN(numValue) && !isNaN(numProductValue)) {
        return numProductValue === numValue;
      }

      const cleanValue = value.replace(/^['"](.*)['"]$/, '$1');
      return String(productValue) === cleanValue;
    }

    if (condition.includes('!=')) {
      const [field, value] = condition.split('!=').map(s => s.trim());
      const productValue = this.getProductValue(field, product);
      if (value === 'null') {
        return productValue !== null && productValue !== undefined;
      }
      const cleanValue = value.replace(/^['"](.*)['"]$/, '$1');
      return productValue !== cleanValue;
    }

    return false;
  }

  /**
   * Obtém um valor do produto a partir de um caminho de campo
   */
  private getProductValue(field: string, product: ProductDocument): any {
    const parts = field.split('.');
    let value: any = product;

    for (const part of parts) {
      // Handle generic cases where product is a document with accessors
      // But for getting raw data, ensure we access standard props
      if (value === null || value === undefined) {
        return null;
      }
      value = value[part];
    }

    return value;
  }
}

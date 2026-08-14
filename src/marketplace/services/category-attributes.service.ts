import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MarketplaceCategoryModel, MarketplaceCategoryDocument } from '../schemas/marketplace-category.schema';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { MercadoLivreService } from './mercado-livre.service';
import { MercadoLivreAttributesService } from './mercado-livre-attributes.service';
import { MarketplaceConfigCacheService } from './marketplace-config-cache.service';

@Injectable()
export class CategoryAttributesService {
  private readonly logger = new Logger(CategoryAttributesService.name);
  private readonly cache = new Map<string, any>();
  private readonly CACHE_TTL = 3600000; // 1 hora
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly marketplaceAuthService: MarketplaceAuthService,
    @InjectModel(MarketplaceCategoryModel.name)
    private marketplaceCategoryModel: Model<MarketplaceCategoryDocument>,
    private mercadoLivreService: MercadoLivreService,
    private readonly mercadoLivreAttributesService: MercadoLivreAttributesService,
    private readonly configCache: MarketplaceConfigCacheService,
  ) { }

  async getCategoryAttributes(categoryId: string, marketplaceId: string): Promise<any> {
    try {
      // Validar marketplace via Mongoose
      let marketplace;
      // Check if valid ObjectId to prevent CastError if legacy ID is passed
      if (/^[0-9a-fA-F]{24}$/.test(marketplaceId)) {
        marketplace = await this.configCache.getById(marketplaceId);
      } else {
        // Fallback/Log for legacy
        this.logger.warn(`Invalid Hex ObjectId received: ${marketplaceId}`);
        // Try finding by legacy numeric id if your schema supports it, or just fail gracefully
        // For now, fail to enforce migration but avoid crash
        throw new BadRequestException(`ID de Marketplace inválido: ${marketplaceId}`);
      }

      if (!marketplace) {
        throw new NotFoundException(`Marketplace com ID ${marketplaceId} não encontrado`);
      }

      // Validar categoryId
      if (!categoryId || typeof categoryId !== 'string') {
        throw new BadRequestException('ID da categoria inválido');
      }

      // Verificar cache
      const cacheKey = `${marketplaceId}-${categoryId}`;
      const cachedData = this.cache.get(cacheKey);

      if (cachedData && Date.now() - cachedData.timestamp < this.CACHE_TTL) {
        this.logger.log(`Retornando dados do cache para categoria ${categoryId}`);
        return cachedData.data;
      }

      // Buscar atributos do Mercado Livre
      const attributes = await this.mercadoLivreAttributesService.getCategoryAttributes(categoryId, String(marketplaceId));

      if (!attributes || !Array.isArray(attributes)) {
        throw new NotFoundException(`Atributos não encontrados para a categoria ${categoryId}`);
      }

      // Processar e formatar os atributos
      const formattedAttributes = attributes.map(attr => ({
        id: attr.id,
        name: attr.name,
        value_type: attr.value_type,
        values: attr.values || [],
        tags: attr.tags || {},
        hint: attr.hint || '',
        allowed_units: attr.allowed_units || []
      }));

      // Armazenar em cache
      this.cache.set(cacheKey, {
        data: formattedAttributes,
        timestamp: Date.now()
      });

      return formattedAttributes;
    } catch (error) {
      this.logger.error(`Erro ao buscar atributos da categoria ${categoryId}:`, error);

      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new Error(`Erro ao buscar atributos da categoria: ${error.message}`);
    }
  }

  async validateAndCompleteAttributes(
    productData: any,
    categoryId: string,
    marketplaceId: string
  ): Promise<any> {
    try {
      this.logger.log(`Iniciando validação de atributos para categoria ${categoryId}`);

      // Busca os atributos obrigatórios da categoria
      const categoryAttributes = await this.getCategoryAttributes(categoryId, marketplaceId);

      // Filtra apenas os atributos obrigatórios
      const requiredAttributes = categoryAttributes.filter(attr => attr.tags?.required);

      this.logger.log(`Encontrados ${requiredAttributes.length} atributos obrigatórios`);

      // Cria um mapa dos atributos existentes no produto
      const existingAttributes = new Map(
        productData.attributes?.map(attr => [attr.id, attr]) || []
      );

      // Lista para armazenar atributos faltantes
      const missingAttributes = [];

      // Verifica cada atributo obrigatório
      for (const requiredAttr of requiredAttributes) {
        if (!existingAttributes.has(requiredAttr.id)) {
          missingAttributes.push({
            id: requiredAttr.id,
            name: requiredAttr.name,
            value_type: requiredAttr.value_type,
            values: requiredAttr.values,
            required: true,
          });
        }
      }

      // Se houver atributos faltantes, adiciona ao produto
      if (missingAttributes.length > 0) {
        if (!productData.attributes) {
          productData.attributes = [];
        }

        productData.attributes.push(...missingAttributes);

        this.logger.log(`Atributos adicionados ao produto: ${JSON.stringify(missingAttributes)}`);
      }

      return productData;
    } catch (error) {
      this.logger.error('Erro ao validar e completar atributos:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      throw error;
    }
  }

  private async getAccessToken(marketplaceId: number): Promise<string> {
    // Implementar lógica para obter o token de acesso do marketplace
    // Pode ser através de um serviço de autenticação
    return 'seu-token-aqui';
  }


  async syncCategoryAttributes(categoryId: number, marketplaceId: number): Promise<void> {
    // Logic to sync attributes should use Mongoose update
    this.logger.log(`Syncing category attributes for ${categoryId} on marketplace ${marketplaceId}`);
    // Implementation pending - skipping TypeORM save
  }

  async validateProductAttributes(product: any, categoryId: number): Promise<{ isValid: boolean; errors: string[] }> {
    // Validate using Mongoose model
    return { isValid: true, errors: [] }; // Temporary stub
  }

  private validateAttributeValue(value: string, attribute: any): string | null {
    return null;
  }

  private async fetchMarketplaceAttributes(
    categoryId: number,
    marketplaceId: number
  ): Promise<any[]> {
    // Stub
    return [];
  }
}
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import { ProductDocument, ProductModel } from '../../product/product-types';
import { MarketplaceCategoryModel, MarketplaceCategoryDocument } from '../schemas/marketplace-category.schema';
// import { CategoryMappingModel, CategoryMappingDocument } from '../schemas/category-mapping.schema';
import { MercadoLivreCategoryAdapter } from '../adapters/mercado-livre/mercado-livre-category.adapter';
import { CategoryAttributesService } from './category-attributes.service';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { ProductService } from '../../product/product.service';
import { MarketplaceService } from './marketplace.service';

@Injectable()
export class CategorySuggestionService {
  private readonly logger = new Logger(CategorySuggestionService.name);
  private genAI: GoogleGenAI;

  constructor(
    private configService: ConfigService,
    @InjectModel(ProductModel.name)
    private productModel: Model<ProductDocument>,
    @InjectModel(MarketplaceCategoryModel.name)
    private marketplaceCategoryModel: Model<MarketplaceCategoryDocument>,
    private mercadoLivreCategoryAdapter: MercadoLivreCategoryAdapter,
    private categoryAttributesService: CategoryAttributesService,
    private marketplaceAuthService: MarketplaceAuthService,
    @Inject(forwardRef(() => ProductService)) private productService: ProductService,
    @Inject(forwardRef(() => MarketplaceService)) private marketplaceService: MarketplaceService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY não configurad');
    } else {
      this.genAI = new GoogleGenAI({ apiKey: apiKey });
    }
  }

  private async getProductDescription(product: any): Promise<string> {
    try {
      if (!this.genAI) {
        this.logger.warn('Google GenAI não inicializado. Usando descrição básica do produto.');
        return `${product.titles?.[0]?.title || product.name}`.trim();
      }

      const prompt = `Busque a descrição simples do seguinte produto: partnumber: ${product.partNumber} - brand: ${product.brand.name}, retornar somente a descrição básica do item.`;

      this.logger.log('Enviando prompt para o Gemini:', { prompt });

      const result = await this.genAI.models.generateContent(
        {
          model: 'gemini-2.5-flash-preview-05-20',
          contents: [
            {
              text: prompt
            }
          ]
        }
      );

      if (!result) {
        this.logger.error('Resposta inválida do Gemini:', result);
        return `${product.titles?.[0]?.title || product.name}`.trim();
      }

      const text = result.text
      if (!text) {
        this.logger.error('Texto não encontrado na resposta do Gemini:', result);
        return `${product.titles?.[0]?.title || product.name}`.trim();
      }

      // Limpar a descrição gerada
      const cleanDescription = text
        .replace(/["']/g, '') // Remove aspas
        .replace(/\n/g, ' ') // Substitui quebras de linha por espaços
        .replace(/\s+/g, ' ') // Remove espaços extras
        .trim();

      this.logger.log('Descrição gerada pelo Gemini:', { cleanDescription });
      return cleanDescription;
    } catch (error) {
      // Silently fail or log debug only as this is an enhancement feature
      this.logger.debug(`Erro ao gerar descrição com Gemini: ${error.message}`);
      return `${product.titles?.[0]?.title || product.name}`.trim();
    }
  }

  private getBasicDescription(product: any): string {
    const basicDescription = [
      product.name,
      product.brand?.name,
      product.partNumber,
      'Peça automotiva',
      'Componente de segurança'
    ].filter(Boolean).join(' ');

    this.logger.log(`Usando descrição básica do produto: ${basicDescription}`);
    return basicDescription;
  }

  async suggestAndMapCategory(productId: string, marketplaceId: string | number): Promise<any> {
    try {
      // 1. Obter o produto
      const product = await this.productService.findOne(productId);
      if (!product) {
        throw new Error(`Produto com ID ${productId} não encontrado`);
      }

      // 2. Obter descrição do produto
      const productDescription = await this.getProductDescription(product);
      if (!productDescription) {
        throw new Error('Não foi possível obter uma descrição válida para o produto');
      }

      // 3. Obter token de acesso do marketplace usando o serviço existente
      const validToken = await this.marketplaceAuthService.ensureValidToken(marketplaceId);
      if (!validToken || !validToken.accessToken) {
        throw new Error('Não foi possível obter um token de acesso válido para o marketplace');
      }

      this.logger.log(`Token obtido com sucesso para o marketplace ${marketplaceId}`);

      // 4. Buscar categoria sugerida usando domain_discovery
      const searchText = product.name
        ? `${product.name} ${productDescription}`
        : productDescription;

      const cleanSearchText = searchText
        .replace(/null/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      this.logger.log('Texto de busca para categoria:', {
        originalName: product.name,
        description: productDescription,
        finalSearchText: cleanSearchText
      });

      const suggestedCategory = await this.mercadoLivreCategoryAdapter.discoverCategory(cleanSearchText);

      if (!suggestedCategory || !suggestedCategory.category_id) {
        throw new Error('Nenhuma categoria válida encontrada para o produto');
      }

      // Armazenar o ID da categoria para uso consistente
      const categoryId = suggestedCategory.category_id;
      this.logger.log(`Categoria sugerida encontrada: ${suggestedCategory.name} (${categoryId})`);

      // 5. Verificar se a categoria já existe no marketplace
      let marketplaceCategory = await this.marketplaceCategoryModel.findOne({
        externalId: String(categoryId)
      }).exec();

      if (!marketplaceCategory) {
        marketplaceCategory = await new this.marketplaceCategoryModel({
          marketplace: marketplaceId, // Ref to MarketplaceModel
          externalId: String(categoryId),
          name: suggestedCategory.name,
          path: suggestedCategory.path_from_root?.map(p => p.name).join(' > ') || suggestedCategory.name,
          attributes: suggestedCategory.attributes || {},
          settings: suggestedCategory.settings || {},
        }).save();
      }

      // 6. (SKIP) Não criar categoria interna nem mapeamento automaticamente
      // O usuário solicitou apenas a descoberta e persistência da categoria do marketplace.

      return {
        success: true,
        message: 'Categoria sugerida encontrada com sucesso (sem mapeamento automático)',
        data: {
          suggestedCategory,
          marketplaceCategory,
          // internalCategory: null,
          // mapping: null,
          productDescription,
        }
      };
    } catch (error) {
      this.logger.error('Erro ao sugerir e mapear categoria:', error);
      this.logger.error('Stack trace:', error.stack);
      throw error;
    }
  }
}
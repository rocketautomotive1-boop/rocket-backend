import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
// Removed TypeORM imports
import { CategoryMappingService } from './category/category-mapping.service';
import { MarketplaceDescriptionService } from './marketplace-description.service';
import axios from 'axios';
import { ProductService } from '../../product/product.service';
import { ProductDocument, ProductTitle } from '../../product/product-types';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { MercadoLivreAdapter } from '../adapters/mercado-livre/mercado-livre.adapter';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { MarketplaceIntegrationHelperService } from './marketplace-integration-helper.service';
import { MercadoLivreAttributesService } from './mercado-livre-attributes.service';
import { ProductAttributesService } from './product-attributes.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { MercadoLivreCategoryAdapter } from '../adapters/mercado-livre/mercado-livre-category.adapter';
import { MercadoLivreProductAdapter } from '../adapters/mercado-livre/mercado-livre-product.adapter';
import { ListingService } from '../../listing/listing.service'; // [NEW]
import { ListingDocument } from '../../listing/schemas/listing.schema'; // [NEW]

@Injectable()
export class MercadoLivreService {
  private readonly logger = new Logger(MercadoLivreService.name);
  private readonly baseUrl = 'https://api.mercadolibre.com';
  constructor(
    private mercadoLivreAdapter: MercadoLivreAdapter,
    private marketplaceAuthService: MarketplaceAuthService,
    @Inject(forwardRef(() => MarketplaceIntegrationHelperService))
    private helperService: MarketplaceIntegrationHelperService,
    @Inject(forwardRef(() => CategoryMappingService))
    private categoryMappingService: CategoryMappingService,
    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private descriptionService: MarketplaceDescriptionService,
    @Inject(forwardRef(() => ProductAttributesService))
    private productAttributesService: ProductAttributesService,
    private readonly httpService: HttpService,
    private mercadoLivreCategoryAdapter: MercadoLivreCategoryAdapter,
    private mercadoLivreProductAdapter: MercadoLivreProductAdapter,
    @Inject(forwardRef(() => ProductService))
    private productService: ProductService,
    private listingService: ListingService, // [NEW]
  ) { }

  /**
   * Cria um produto no Mercado Livre
   */
  // async createProduct(product: Product, marketplace: Marketplace): Promise<any> {
  //   this.logger.log(`Criando produto ID ${product.id} no Mercado Livre`);

  //   // Adicionar logs para debug
  //   console.log('Produto original:', JSON.stringify(product, null, 2));

  //   try {
  //     // Validar dados obrigatórios do produto
  //     const missingFields = [];

  //     if (!product.name) missingFields.push('nome');
  //     if (!product.partNumber) missingFields.push('partNumber');
  //     if (!product.brand?.name) missingFields.push('marca');
  //     if (!product.category?.id) missingFields.push('categoria');
  //     if (!product.productImages || product.productImages.length === 0) missingFields.push('imagens');
  //     if (!product.productMovements || product.productMovements.length === 0) missingFields.push('inventário');
  //     if (!product.price && (!product.productMovements || product.productMovements.length === 0 || !product.productMovements[0].price)) {
  //       missingFields.push('preço');
  //     }

  //     if (missingFields.length > 0) {
  //       throw new Error(`Produto não pode ser criado no Mercado Livre. Campos obrigatórios ausentes: ${missingFields.join(', ')}`);
  //     }

  //     // Obter token válido
  //     const token = await this.marketplaceAuthService.ensureValidToken(marketplace.id);

  //     if (!token) {
  //       throw new Error('Token de acesso não disponível para o Mercado Livre');
  //     }

  //     // Obter categoria mapeada para o produto
  //     const categoryId = await this.helperService.getMarketplaceCategoryForProduct(product, marketplace.id);

  //     if (!categoryId) {
  //       throw new Error('Categoria não mapeada para o Mercado Livre');
  //     }

  //     // Obter descrição formatada para o Mercado Livre
  //     const description = await this.helperService.getFormattedDescription(product, marketplace.id);

  //     // Verificar se tem movimentos
  //     if (!product.productMovements || product.productMovements.length === 0) {
  //       throw new Error('Produto não possui movimentos');
  //     }

  //     // Pegar o primeiro movimento
  //     const movement = product.productMovements[0];

  //     // Validar preço e quantidade
  //     if (!movement.price || movement.price <= 0) {
  //       throw new Error('Preço do produto é inválido ou não foi fornecido');
  //     }

  //     if (!movement.quantity || movement.quantity <= 0) {
  //       throw new Error('Quantidade do produto é inválida ou não foi fornecida');
  //     }

  //     // Preparar dados para o Mercado Livre
  //     const mlData = {
  //       // Dados básicos
  //       title: product.name,
  //       partNumber: product.partNumber,
  //       category_id: categoryId,

  //       // Dados de preço e estoque - Usando dados do movimento
  //       price: movement.price,
  //       currency_id: 'BRL',
  //       available_quantity: movement.quantity,

  //       // Dados de inventário
  //       inventory: [{
  //         price: movement.price,
  //         quantity: movement.quantity,
  //         condition: 'new'
  //       }],

  //       // Dados de marca
  //       brand: product.brand,

  //       // Dados de descrição
  //       description: { plain_text: description },

  //       // Dados de imagens
  //       images: this.mapPictures(product),

  //       // Dados de atributos
  //       attributes: this.mapAttributes(product),

  //       // Dados de dimensões
  //       length: product.length,
  //       width: product.width,
  //       height: product.height,
  //       weight: product.weight,

  //       // Dados de título
  //       name: product.name,

  //       // Token de acesso
  //       accessToken: token.accessToken
  //     };

  //     // Log dos dados preparados
  //     console.log('Dados preparados para ML:', JSON.stringify(mlData, null, 2));

  //     // Criar produto
  //     const response = await this.mercadoLivreAdapter.createProduct(mlData);

  //     if (!response || !response.id) {
  //       throw new Error('Falha ao criar produto no Mercado Livre: resposta inválida');
  //     }

  //     // Atualizar descrição separadamente
  //     try {
  //       await this.mercadoLivreAdapter.updateProductDescription(response.id, {
  //         text: description,
  //         accessToken: token.accessToken
  //       });
  //     } catch (error) {
  //       this.logger.warn(`damatualizar descrição do produto ${response.id}:`, error);
  //     }

  //     // Salvar integração
  //     const productMarketplace = await this.saveProductMarketplace(product, marketplace, response.id);

  //     return {
  //       success: true,
  //       response,
  //       productMarketplaceId: productMarketplace.id,
  //       externalId: response.id,
  //       marketplaceData: response.marketplaceData || response.response || response.rawResponse,
  //       apiResponse: response.marketplaceData || response.response || response.rawResponse
  //     };
  //   } catch (error) {
  //     return this.helperService.handleError(error, marketplace, 'create');
  //   }
  // }

  /**
   * Atualiza um produto no Mercado Livre
   */
  async updateProduct(product: ProductDocument, marketplace: MarketplaceDocument, productTitle: any): Promise<any> {
    const listingId = productTitle._id || productTitle.id;
    this.logger.log(`Atualizando produto ${product._id} no Mercado Livre (External ID: ${productTitle.externalId})`);

    try {
      // Buscar o produto completo
      const completeProduct = await this.productService.findDocument(String(product._id));

      if (!completeProduct) {
        throw new Error(`Produto ID ${product._id} não encontrado`);
      }

      // Obter token válido
      const token = await this.marketplaceAuthService.ensureValidToken(marketplace._id);


      if (!token) {
        throw new Error('Token de acesso não disponível para o Mercado Livre');
      }

      // Obter categoria mapeada para o produto
      const categoryId = await this.helperService.getMarketplaceCategoryForProduct(completeProduct, marketplace._id);

      if (!categoryId) {
        throw new Error('Categoria não mapeada para o Mercado Livre');
      }

      // Obter descrição formatada
      const description = await this.helperService.getFormattedDescription(completeProduct, marketplace._id);

      // Calcular estoque real baseado nas movimentações (inbound soma, outbound subtrai)
      const availableQty = await this.getAvailableQuantity(completeProduct);

      // Preparar dados para atualização
      const mlData = {
        // Dados básicos
        title: completeProduct.name,
        category_id: categoryId,

        // Dados de preço e estoque
        price: completeProduct.price,
        available_quantity: availableQty,

        // Dados de inventário
        inventory: [{
          price: completeProduct.price,
          quantity: availableQty,
          condition: 'new'
        }],

        // Dados de imagens
        pictures: this.mapPictures(completeProduct),

        // Dados de atributos
        attributes: this.mapAttributes(completeProduct),

        // Dados de descrição
        description: { plain_text: description },

        // Dados de dimensões
        length: completeProduct.dimensions?.length,
        width: completeProduct.dimensions?.width,
        height: completeProduct.dimensions?.height,
        weight: completeProduct.weight,

        // Token de acesso
        accessToken: token.accessToken
      };

      // Tentar atualização condicional primeiro
      let response;
      try {
        response = await this.mercadoLivreProductAdapter.updateProductConditional(
          productTitle.externalId,
          mlData
        );

        this.logger.log(`Atualização condicional realizada para o produto ${productTitle.externalId}`);

        // Se a atualização foi parcial ou restrita, logar as informações
        if (response.status === 'partial_update' || response.status === 'restricted') {
          this.logger.warn(`Atualização parcial/restrita para produto ${productTitle.externalId}: ${response.message}`);

          // Se foi restrita, tentar atualizar apenas campos básicos
          if (response.status === 'restricted') {
            const basicUpdateData = {
              price: completeProduct.price,
              available_quantity: availableQty,
              accessToken: token.accessToken
            };

            try {
              const basicResponse = await this.mercadoLivreProductAdapter.updateProductConditional(
                productTitle.externalId,
                basicUpdateData
              );

              this.logger.log(`Atualização básica realizada para produto restrito ${productTitle.externalId}`);
              response = basicResponse;
            } catch (basicError) {
              this.logger.error(`Erro na atualização básica do produto restrito ${productTitle.externalId}:`, basicError);
            }
          }
        }
      } catch (updateError) {
        this.logger.error(`Erro na atualização condicional do produto ${productTitle.externalId}:`, updateError);

        // Se falhar, tentar atualização tradicional
        try {
          response = await this.mercadoLivreAdapter.updateProduct(
            productTitle.externalId,
            mlData
          );
          this.logger.log(`Atualização tradicional realizada para o produto ${productTitle.externalId}`);
        } catch (traditionalError) {
          this.logger.error(`Erro na atualização tradicional do produto ${productTitle.externalId}:`, traditionalError);
          throw traditionalError;
        }
      }


      // Atualizar data de integração
      // [REF] Update Listing
      if (listingId) {
        await this.listingService.updateStatus(listingId, 'active'); // or 'synced' if mapped
      } else {
        // Try to find if we don't have ID but have external
        if (productTitle.externalId) {
          const l = await this.listingService.findOne({ marketplaceId: marketplace._id, externalId: productTitle.externalId });
          if (l) await this.listingService.updateStatus(l.id, 'active');
        }
      }

      return {
        success: true,
        response,
        productTitleId: (productTitle as any)._id || (productTitle as any).id,
        externalId: productTitle.externalId,
        marketplaceData: response.marketplaceData || response.response || response.rawResponse,
      };
    } catch (error) {
      return this.helperService.handleError(error, marketplace, 'update');
    }
  }

  /**
   * Testa a atualização de um item no Mercado Livre
   */
  async testItemUpdate(externalId: string, testData: any): Promise<any> {
    return this.mercadoLivreProductAdapter.updateProductConditional(externalId, testData);
  }

  /**
   * Consulta um item no Mercado Livre
   */
  async getItem(externalId: string, accessToken: string): Promise<any> {
    return this.mercadoLivreProductAdapter.getItem(externalId, accessToken);
  }

  /**
   * Verifica se um item pode ser atualizado
   */
  async canUpdateItem(itemData: any): Promise<{ canUpdate: boolean; restrictions: string[] }> {
    return this.mercadoLivreProductAdapter.canUpdateItem(itemData);
  }

  /**
   * Filtra campos que podem ser atualizados
   */
  async filterUpdatableFields(updateData: any, restrictions: string[]): Promise<any> {
    return this.mercadoLivreProductAdapter['filterUpdatableFields'](updateData, restrictions);
  }

  /**
   * Consulta o status de um item no Mercado Livre
   */
  async getItemStatus(productTitle: ProductTitle, marketplace: MarketplaceDocument): Promise<any> {
    this.logger.log(`Consultando status do item ${productTitle.externalId} no Mercado Livre`);

    try {
      // Obter token válido
      const token = await this.marketplaceAuthService.ensureValidToken(marketplace._id);

      if (!token) {
        throw new Error('Token de acesso não disponível para o Mercado Livre');
      }

      // Consultar o item
      const itemData = await this.mercadoLivreProductAdapter.getItem(
        productTitle.externalId,
        token.accessToken
      );

      // Verificar restrições
      const { canUpdate, restrictions } = this.mercadoLivreProductAdapter.canUpdateItem(itemData);

      return {
        externalId: productTitle.externalId,
        status: itemData.status,
        canUpdate,
        restrictions,
        itemData: {
          status: itemData.status,
          hasBids: itemData.initial_quantity !== itemData.available_quantity,
          soldQuantity: itemData.sold_quantity,
          availableQuantity: itemData.available_quantity,
          initialQuantity: itemData.initial_quantity,
          price: itemData.price,
          title: itemData.title
        },
        message: canUpdate
          ? 'Item pode ser atualizado normalmente'
          : `Item não pode ser atualizado devido a: ${restrictions.join(', ')} `
      };
    } catch (error) {
      this.logger.error(`Erro ao consultar status do item ${productTitle.externalId}: `, error);
      return this.helperService.handleError(error, marketplace, 'get_status');
    }
  }

  // Atualizar o método mapAttributes para incluir todos os atributos necessários
  private mapAttributes(product: ProductDocument): any[] {
    const attributes = [];

    // Log para debug
    console.log('Mapeando atributos do produto:', JSON.stringify(product.attributes, null, 2));

    // Atributos básicos
    if (product.brand?.name) {
      attributes.push({
        id: 'BRAND',
        value_name: product.brand.name,
        value_type: 'string'
      });
    }

    if (product.partNumber) {
      attributes.push({
        id: 'PART_NUMBER',
        value_name: product.partNumber,
        value_type: 'string'
      });
    }

    if (product.partNumber) {
      attributes.push({
        id: 'OEM',
        value_name: product.partNumber,
        value_type: 'string'
      });
    }

    if (product.barcode) {
      attributes.push({
        id: 'GTIN',
        value_name: product.barcode,
        value_type: 'string'
      });
    }

    // Adicionar atributos do produto
    if (product.attributes && Array.isArray(product.attributes)) {
      product.attributes.forEach(attr => {
        if (attr.code && attr.value) {
          // Verificar se o atributo já não foi adicionado
          const existingAttribute = attributes.find(a => a.id === attr.code);
          if (!existingAttribute) {
            attributes.push({
              id: attr.code,
              value_name: String(attr.value),
              value_type: 'string'
            });
          }
        }
      });
    }

    // Validar formato dos atributos antes de retornar
    const validatedAttributes = attributes.map(attr => {
      if (!attr.id || !attr.value_name) {
        console.warn('Atributo inválido encontrado:', attr);
        return null;
      }
      return {
        id: attr.id,
        value_name: attr.value_name,
        value_type: attr.value_type || 'string'
      };
    }).filter(attr => attr !== null);

    // Log para debug
    console.log('Atributos mapeados e validados:', JSON.stringify(validatedAttributes, null, 2));

    return validatedAttributes;
  }

  /*
  // Salva a integração do produto com o Mercado Livre
  async saveProductMarketplace(
    product: Product,
    marketplace: Marketplace,
    externalId: string
  ): Promise<ProductTitle> {
    const existing = await this.productTitleRepository.findOne({
      where: { product: { id: product.id }, marketplace: { id: marketplace.id } },
    });

    if (existing) {
      existing.externalId = externalId;
      existing.lastSyncAt = new Date();
      existing.syncStatus = 'synced';
      return this.productTitleRepository.save(existing);
    }

    const title = this.productTitleRepository.create({
      product: { id: product.id },
      marketplace: { id: marketplace.id },
      externalId,
      title: product.name,
      status: 'active',
      syncStatus: 'synced',
      lastSyncAt: new Date(),
    });

    return this.productTitleRepository.save(title);
  }
  */

  // Atualiza a data de sincronização da integração
  async updateProductTitleLocal(product: ProductDocument, productTitle: ProductTitle): Promise<any> {
    productTitle.lastSyncAt = new Date();
    await product.save();
    return productTitle;
  }

  /**
   * Mapeia as imagens do produto para o formato do Mercado Livre
   */
  private mapPictures(product: ProductDocument): any[] {
    if (!product.images || !Array.isArray(product.images)) {
      return [];
    }

    return product.images.map(img => ({
      source: img.url,
    }));
  }

  /**
   * Obtém a quantidade disponível do produto baseada nos movimentos
   */
  private async getAvailableQuantity(product: ProductDocument): Promise<number> {
    return this.productService.getProductStock(String(product._id));
  }

  async discoverCategory(title: string, product: ProductDocument): Promise<any> {
    try {
      // Buscar o marketplace do Mercado Livre
      // Note: Marketplace is still TypeORM for now
      const marketplaceId = 1;

      /*
      if (!marketplace) {
        throw new Error('Marketplace Mercado Livre não encontrado');
      }
      */

      // Obter token válido usando o novo serviço
      const accessToken = '';

      try {
        // Buscar categoria sugerida
        const suggestedCategory = await this.mercadoLivreAdapter.discoverCategory(
          accessToken,
          title
        );

        this.logger.log('Categoria sugerida:', JSON.stringify(suggestedCategory, null, 2));

        // Buscar detalhes da categoria
        const categoryDetails = await this.mercadoLivreAdapter.getCategoryDetails(
          accessToken,
          suggestedCategory.category_id
        );

        this.logger.log('Detalhes da categoria:', JSON.stringify(categoryDetails, null, 2));

        // Retornar resultado formatado
        return {
          ...suggestedCategory,
          details: categoryDetails
        };

      } catch (error) {
        // Se for erro 403, tentar renovar o token e tentar novamente
        if (error.response?.status === 403) {
          this.logger.log('Erro 403 detectado, tentando renovar token...');

          // Limpar cache do token para forçar renovação
          //this.tokenService.clearCache(marketplace.id);

          // Obter novo token
          const newAccessToken = '';

          // Tentar novamente com o novo token
          const suggestedCategory = await this.mercadoLivreAdapter.discoverCategory(
            newAccessToken,
            title
          );

          const categoryDetails = await this.mercadoLivreAdapter.getCategoryDetails(
            newAccessToken,
            suggestedCategory.category_id
          );

          return {
            ...suggestedCategory,
            details: categoryDetails
          };
        }

        // Se não for erro 403, propaga o erro
        throw error;
      }
    } catch (error) {
      this.logger.error('Erro ao buscar categoria sugerida:', error);
      throw error;
    }
  }

  async getProductAttributes(productId: number): Promise<{
    required: any[];
    optional: any[];
  }> {
    return this.productAttributesService.getProductAttributes(productId);
  }

  async saveProductAttributes(product: ProductDocument, marketplace: any, categoryId: string, attributes: Array<{ id: string; value: string }>) {
    await this.productAttributesService.saveProductAttributes(
      product as any,
      marketplace,
      categoryId,
      attributes
    );
  }

  async updateProductAttributes(productId: number | string, attributes: Array<{ id: string; value: string }>) {
    try {
      const product = await this.productService.findDocument(String(productId));

      if (!product) {
        throw new Error('Produto não encontrado');
      }

      // Find ML title
      // [REF] Fetch listings
      const listings = await this.listingService.findByProduct(product._id);
      const productTitle = listings.find(t => (t as any).marketplaceName === 'Mercado Livre' || String(t.marketplaceId) === '1'); // Assuming 1 is ML

      if (!productTitle) {
        throw new Error('Produto não encontrado no marketplace Mercado Livre');
      }

      // Usar saveProductAttributes em vez de updateProductAttributes
      return this.productAttributesService.saveProductAttributes(
        product as any,
        productTitle.marketplaceId as any,
        productTitle.externalId,
        attributes
      );
    } catch (error) {
      this.logger.error('Erro ao atualizar atributos do produto:', error);
      throw error;
    }
  }

  async domainDiscovery(title: string): Promise<any> {
    return this.mercadoLivreCategoryAdapter.domainDiscovery(title);
  }

  async getCategory(categoryId: string): Promise<any> {
    const response = await this.mercadoLivreCategoryAdapter.getCategory(categoryId);
    return response.data;
  }

  async getCategoryAttributes(categoryId: string): Promise<any> {
    const response = await this.mercadoLivreCategoryAdapter.getCategoryAttributes(categoryId);
    return response.data;
  }

  async getDomainWithCategories(title: string): Promise<any> {
    return this.mercadoLivreCategoryAdapter.getDomainAndCategories(title);
  }

  async getDomainWithCategoryAndAttributes(title: string): Promise<any> {
    return this.mercadoLivreCategoryAdapter.getDomainWithCategoryAndAttributes(title);
  }
}

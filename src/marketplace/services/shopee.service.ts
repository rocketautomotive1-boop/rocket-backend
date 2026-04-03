import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { MarketplaceDocument } from '../schemas/marketplace.schema';
import { ProductDocument, ProductMovement } from '../../product/product-types';
import { ProductTitle } from '../../product/product-types';
import { ShopeeAdapter } from '../adapters/shopee/shopee.adapter';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';
import { MarketplaceIntegrationHelperService } from './marketplace-integration-helper.service';
import { CategoryMappingService } from './category/category-mapping.service';
import { MarketplaceDescriptionService } from './marketplace-description.service';
import { ProductService } from '../../product/product.service';

@Injectable()
export class ShopeeService {
  private readonly logger = new Logger(ShopeeService.name);

  constructor(
    private shopeeAdapter: ShopeeAdapter,
    @Inject(forwardRef(() => MarketplaceAuthService))
    private marketplaceAuthService: MarketplaceAuthService,
    @Inject(forwardRef(() => MarketplaceIntegrationHelperService))
    private helperService: MarketplaceIntegrationHelperService,
    @Inject(forwardRef(() => CategoryMappingService))
    private categoryMappingService: CategoryMappingService,
    @Inject(forwardRef(() => MarketplaceDescriptionService))
    private descriptionService: MarketplaceDescriptionService,
    @Inject(forwardRef(() => ProductService))
    private productService: ProductService,
  ) { }

  /**
   * Cria um produto na Shopee
   */
  async createProduct(product: ProductDocument, marketplace: MarketplaceDocument): Promise<any> {
    this.logger.log(`Criando produto ID ${String(product._id)} na Shopee`);

    try {
      // Obter token válido
      const token = await this.marketplaceAuthService.ensureValidToken(marketplace._id);

      this.logger.log(`[ShopeeService] Token retrieved: ${token ? 'YES' : 'NO'}`);
      if (token) {
        this.logger.log(`[ShopeeService] Token structure: ${JSON.stringify({
          hasAdditionalData: !!token.additionalData,
          additionalData: token.additionalData,
          shopIdRoot: (token as any).shopId
        })}`);
      }

      if (!token || !token.additionalData || !token.additionalData.shopId) {
        // Fallback: try to see if shopId is at the root or under 'shop_id' in additionalData
        const shopIdFallback = (token as any).shopId || token.additionalData?.shop_id;
        if (shopIdFallback && token.additionalData) {
          token.additionalData.shopId = shopIdFallback;
          this.logger.log(`[ShopeeService] Recovered shopId from fallback: ${shopIdFallback}`);
        } else {
          throw new Error('Token de acesso ou shopId não disponível para a Shopee');
        }
      }

      // Obter categoria mapeada para o produto, com fallback padrão 102273 quando não houver mapeamento
      const categoryId = await this.helperService.getMarketplaceCategoryForProduct(product, marketplace._id);
      const normalizedCategoryId = categoryId ? parseInt(String(categoryId)) : 102273;
      if (!normalizedCategoryId || isNaN(normalizedCategoryId)) {
        throw new Error('Categoria não mapeada para a Shopee');
      }

      // Obter descrição formatada para a Shopee
      const description = await this.helperService.getFormattedDescription(product, marketplace._id);

      let cachedImageIds: string[] = []
      // try {
      //   const existingPm = await this.productTitleRepository.findOne({
      //     where: { product: { id: product.id }, marketplace: { id: marketplace.id } },
      //     relations: ['product', 'marketplace'],
      //   })
      //   const fromData = (existingPm?.marketplaceData as any)?.shopeeImageIds
      //   if (Array.isArray(fromData) && fromData.length) cachedImageIds = fromData.map((x: any) => String(x))
      // } catch { }
      // Preferir o título específico da Shopee, quando existir
      const shopeeSpecificTitle = Array.isArray((product as any).titles)
        ? (product as any).titles.find((t: any) =>
          (String(t?.marketplace?.id) === String(marketplace._id)) ||
          (t?.marketplace?.name === 'Shopee') ||
          (String(t?.marketplaceId) === String(marketplace._id))
        )?.title
        : undefined;

      // Se já existir externalId para este produto/marketplace, atualizar em vez de criar
      let externalIdToUpdate: string | null = null;
      // try {
      //   const existingPM = await this.productTitleRepository.findOne({
      //     where: { product: { id: product.id }, marketplace: { id: marketplace.id } },
      //     relations: ['product', 'marketplace'],
      //   });
      //   if (existingPM?.externalId) externalIdToUpdate = String(existingPM.externalId);
      // } catch { }
      if (!externalIdToUpdate && Array.isArray((product as any).titles)) {
        const withExternal = (product as any).titles.find((t: any) =>
          !!t?.externalId && ((String(t?.marketplaceId) === String(marketplace._id)) || (String(t?.marketplace?.id) === String(marketplace._id)))
        );
        if (withExternal?.externalId) externalIdToUpdate = String(withExternal.externalId);
      }

      if (externalIdToUpdate) {
        this.logger.log(`ExternalId detectado (${externalIdToUpdate}) para produto ${String(product._id)}. Executando atualização na Shopee.`);
        const shopeeUpdateData = {
          id: String(product._id),
          item_id: parseInt(externalIdToUpdate),
          shop_id: parseInt(token.additionalData.shopId),
          name: shopeeSpecificTitle || product.name,
          description: description,
          price: (await this.getLatestPrice(product)) ?? product.price,
          stock: await this.getAvailableQuantity(product),
          condition: 'NEW',
          weight: (product.weight && Number(product.weight) > 0) ? (Number(product.weight) / 1000) : 0.1,
          dimension: {
            package_length: (product.dimensions?.length && Number(product.dimensions.length) > 0) ? Number(product.dimensions.length) : 10,
            package_width: (product.dimensions?.width && Number(product.dimensions.width) > 0) ? Number(product.dimensions.width) : 10,
            package_height: (product.dimensions?.height && Number(product.dimensions.height) > 0) ? Number(product.dimensions.height) : 10
          },
          images: this.mapImages(product),
          tax_info: {
            ncm: product.tax?.ncm || (product as any).ncmId || '87089990',
            same_state_cfop: product.tax?.cfop || '5102',
            diff_state_cfop: product.tax?.cfop || '6108',
            csosn: product.tax?.csosn || '',
            origin: product.tax?.origin || '0',
            cest: product.tax?.cest || '0199900',
            measure_unit: 'UN'
          }
        };
        const shopeeUpdateDataWithToken = {
          ...shopeeUpdateData,
          token: {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken, // Incluir refresh token
            additionalData: { shopId: token.additionalData.shopId }
          }
        };
        const updateResponse = await this.shopeeAdapter.updateProduct(externalIdToUpdate, shopeeUpdateDataWithToken);

        // Atualizar token se foi renovado durante o update
        if (updateResponse && updateResponse.token) {
          shopeeUpdateDataWithToken.token = updateResponse.token;
        } else if (updateResponse && updateResponse.accessToken) {
          shopeeUpdateDataWithToken.token = {
            ...shopeeUpdateDataWithToken.token,
            accessToken: updateResponse.accessToken
          }
        }

        // Separadamente, atualizar Estoque e Preço (Shopee V2 exige endpoints específicos)
        // Isso garante que mesmo na "primeira publicação" (que vira update), os valores peguem
        const realPrice = (await this.getLatestPrice(product)) ?? product.price;
        const realStock = await this.getAvailableQuantity(product);

        try {
          await this.shopeeAdapter.updateProductInventory(externalIdToUpdate, {
            quantity: realStock,
            token: shopeeUpdateDataWithToken.token
          });
        } catch (stockErr) {
          this.logger.warn(`Falha ao atualizar estoque Shopee (Create-as-Update): ${stockErr.message}`);
        }

        try {
          await this.shopeeAdapter.updateProductPrice(externalIdToUpdate, {
            price: realPrice,
            token: shopeeUpdateDataWithToken.token
          });
        } catch (priceErr) {
          this.logger.warn(`Falha ao atualizar preço Shopee (Create-as-Update): ${priceErr.message}`);
        }

        // TODO: Refactor title management to use ProductService
        // let pmForUpdate: ProductTitle | null = null;
        // try {
        //   pmForUpdate = await this.productTitleRepository.findOne({ where: { externalId: externalIdToUpdate, marketplace: { id: marketplace.id } }, relations: ['marketplace', 'product'] });
        // } catch { }
        // if (pmForUpdate) {
        //   await this.updateProductMarketplace(pmForUpdate);
        // } else {
        //   await this.saveProductMarketplace(product, marketplace, externalIdToUpdate);
        // }
        try {
          const titles = Array.isArray((product as any).titles) ? (product as any).titles : []
          const titleForShopee = titles.find((t: any) => (String(t?.marketplace?.id) === String(marketplace._id)) || (String(t?.marketplaceId) === String(marketplace._id)))
          if (titleForShopee) {
            await this.helperService.saveTitleExternalId(titleForShopee, externalIdToUpdate, String(product._id), 'Shopee')
          }
        } catch (err) {
          this.logger.warn(`Falha ao salvar externalId no título do produto ${String(product._id)}: ${err.message}`)
        }
        return {
          success: true,
          response: updateResponse,
          // productMarketplaceId: pmForUpdate?.id, // TODO: Refactor
          externalId: externalIdToUpdate,
        };
      }

      const shopeeData = {
        id: String(product._id),
        shop_id: parseInt(token.additionalData.shopId),
        category_id: normalizedCategoryId,
        name: shopeeSpecificTitle || product.name,
        description: description,
        price: (await this.getLatestPrice(product)) ?? ((product.price && Number(product.price) > 0) ? product.price : 10),
        stock: await this.getAvailableQuantity(product),
        weight: (product.weight && Number(product.weight) > 0) ? (Number(product.weight) / 1000) : 0.1,
        dimension: {
          package_length: (product.dimensions?.length && Number(product.dimensions.length) > 0) ? Number(product.dimensions.length) : 10,
          package_width: (product.dimensions?.width && Number(product.dimensions.width) > 0) ? Number(product.dimensions.width) : 10,
          package_height: (product.dimensions?.height && Number(product.dimensions.height) > 0) ? Number(product.dimensions.height) : 10
        },
        logistic_info: [
          {
            enabled: true,
            is_free: false,
            logistic_id: 91003
          }
        ],
        brand: product.brand?.name || '',
        item_sku: product.partNumber || '',
        condition: 'NEW',
        images: this.mapImages(product),
        image_ids: cachedImageIds,
        attributes: this.mapAttributes(product),
        tax_info: {
          ncm: product.tax?.ncm || (product as any).ncmId || '87089990',
          same_state_cfop: product.tax?.cfop || '5102',
          diff_state_cfop: product.tax?.cfop || '6108',
          csosn: product.tax?.csosn || '',
          origin: product.tax?.origin || '0',
          cest: product.tax?.cest || '0199900',
          measure_unit: 'UN'
        }
      };

      // Incluir o token e shopId no objeto do produto para que o adapter possa extraí-los
      const shopeeDataWithToken = {
        ...shopeeData,
        token: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken, // Incluir refresh token
          additionalData: { shopId: token.additionalData.shopId }
        }
      };

      // Enviar para a Shopee
      const response = await this.shopeeAdapter.createProduct(shopeeDataWithToken);

      if (!response || !response.item_id) {
        throw new Error('Falha ao criar produto na Shopee: resposta inválida');
      }

      // TODO: Refactor to use ProductService for title management
      // const productMarketplace = await this.saveProductMarketplace(
      //   product,
      //   marketplace,
      //   response.item_id.toString(),
      //   marketplaceDataSave,
      // );
      try {
        const titles = Array.isArray((product as any).titles) ? (product as any).titles : []
        const titleForShopee = titles.find((t: any) => (String(t?.marketplace?.id) === String(marketplace._id)) || (String(t?.marketplaceId) === String(marketplace._id)) || (t?.marketplace?.name === 'Shopee'))
          || titles.find((t: any) => !t?.marketplaceId)
        if (titleForShopee) {
          await this.helperService.saveTitleExternalId(titleForShopee, response.item_id.toString(), String(product._id), 'Shopee')
        }
      } catch (err) {
        this.logger.warn(`Falha ao salvar externalId no título do produto ${String(product._id)}: ${err.message}`)
      }

      return {
        success: true,
        response,
        // productMarketplaceId: productMarketplace.id, // TODO: Refactor
        externalId: response.item_id.toString(),
      };
    } catch (error) {
      return this.helperService.handleError(error, marketplace, 'create');
    }
  }

  /**
   * Atualiza um produto na Shopee
   */
  async updateProduct(
    product: ProductDocument,
    marketplace: MarketplaceDocument,
    productTitle: ProductTitle
  ): Promise<any> {
    this.logger.log(`Atualizando produto ID ${String(product._id)} na Shopee (externalId: ${productTitle.externalId})`);

    try {
      // Obter token válido
      const token = await this.marketplaceAuthService.ensureValidToken(marketplace._id);

      if (!token || !token.additionalData || !token.additionalData.shopId) {
        throw new Error('Token de acesso ou shopId não disponível para a Shopee');
      }

      // Obter descrição formatada para a Shopee
      const description = await this.helperService.getFormattedDescription(product, String(marketplace._id));

      // Preferir o título específico da Shopee, quando existir (mesma lógica do create)
      const shopeeSpecificTitle = Array.isArray((product as any).titles)
        ? (product as any).titles.find((t: any) =>
          (String(t?.marketplace?.id) === String(marketplace._id)) ||
          (t?.marketplace?.name === 'Shopee') ||
          (String(t?.marketplaceId) === String(marketplace._id))
        )?.title
        : undefined;

      const effectiveName = shopeeSpecificTitle || product.name || product.partNumber || `Produto ${String(product._id)}`;

      // Calculate real values for specific updates
      const realPrice = (await this.getLatestPrice(product)) ?? product.price;
      const realStock = await this.getAvailableQuantity(product);

      // Preparar dados para atualização
      const shopeeData = {
        id: String(product._id),
        item_id: parseInt(productTitle.externalId),
        shop_id: parseInt(token.additionalData.shopId),
        name: effectiveName,
        description: description,
        price: 0, // Metadata update ignores/doesn't need price in V2 logic if updated separately

        stock: 0, // Ignorado pelo adapter no update se não passarmos, mas melhor zerar ou remover
        condition: 'NEW',
        weight: (product.weight && Number(product.weight) > 0) ? (Number(product.weight) / 1000) : 0.1,
        dimension: {
          package_length: (product.dimensions?.length && Number(product.dimensions.length) > 0) ? Number(product.dimensions.length) : 10,
          package_width: (product.dimensions?.width && Number(product.dimensions.width) > 0) ? Number(product.dimensions.width) : 10,
          package_height: (product.dimensions?.height && Number(product.dimensions.height) > 0) ? Number(product.dimensions.height) : 10
        },
        images: this.mapImages(product),
        tax_info: {
          ncm: product.tax?.ncm || (product as any).ncmId || '87089990',
          same_state_cfop: product.tax?.cfop || '5102',
          diff_state_cfop: product.tax?.cfop || '6108',
          csosn: product.tax?.csosn || '',
          origin: product.tax?.origin || '0',
          cest: product.tax?.cest || '0199900',
          measure_unit: 'UN'
        }
      };

      // Incluir o token e shopId no objeto do produto para que o adapter possa extraí-los
      const shopeeDataWithToken = {
        ...shopeeData,
        token: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken, // Incluir refresh token
          additionalData: { shopId: token.additionalData.shopId }
        }
      };

      // Atualizar produto (metadados)
      const response = await this.shopeeAdapter.updateProduct(
        productTitle.externalId,
        shopeeDataWithToken
      );

      // Atualizar token se foi renovado durante o update
      if (response && response.token) {
        shopeeDataWithToken.token = response.token;
      } else if (response && response.accessToken) {
        // Fallback se o adapter retornar formato diferente
        shopeeDataWithToken.token = {
          ...shopeeDataWithToken.token,
          accessToken: response.accessToken
        };
      }

      // Separadamente, atualizar Estoque e Preço (Shopee V2 exige endpoints específicos)
      try {
        await this.shopeeAdapter.updateProductInventory(productTitle.externalId, {
          quantity: realStock,
          token: shopeeDataWithToken.token
        });
      } catch (stockErr) {
        this.logger.warn(`Falha ao atualizar estoque Shopee separado: ${stockErr.message}`);
      }

      try {
        await this.shopeeAdapter.updateProductPrice(productTitle.externalId, {
          price: realPrice,
          token: shopeeDataWithToken.token
        });
      } catch (priceErr) {
        this.logger.warn(`Falha ao atualizar preço Shopee separado: ${priceErr.message}`);
      }

      // TODO: Refactor to use ProductService
      // await this.updateProductMarketplace(productTitle);

      return {
        success: true,
        response,
        // productTitleId: productTitle.id, // TODO: Refactor - ProductTitle doesn't have id
        externalId: productTitle.externalId,
      };
    } catch (error) {
      return this.helperService.handleError(error, marketplace, 'update');
    }
  }



  // TODO: Refactor - ProductAttribute in Mongoose schema doesn't have id property
  // Use attribute code or name instead
  private mapAttributes(product: ProductDocument): any[] {
    const attributes = [];

    // Adicionar atributos do produto
    if (product.attributes && Array.isArray(product.attributes)) {
      for (const attr of product.attributes) {
        // Skip attributes without code - can't map to Shopee
        if (attr.code && attr.value) {
          attributes.push({
            attribute_id: Number(attr.code), // Use code instead of id
            attribute_value_list: [{
              value_id: 0,
              original_value_name: attr.value
            }]
          });
        }
      }
    }

    return attributes;
  }

  /**
   * Mapeia as imagens do produto para o formato da Shopee
   */
  private mapImages(product: ProductDocument): string[] {
    if (!product.images || !Array.isArray(product.images)) {
      return [];
    }

    return product.images.map(img => img.url);
  }

  // TODO: Refactor to use ProductService or StockMovementModel
  private async getAvailableQuantity(product: ProductDocument): Promise<number> {
    return this.productService.getProductStock(String(String(product._id)));
  }

  // TODO: Refactor to use ProductService or custom query
  private async getLatestPrice(product: ProductDocument): Promise<number | null> {
    // If priced at product level, use that.
    return product.price ? Number(product.price.toString()) : null;
  }

  // TODO: Completely refactor these methods to work without TypeORM repositories
  private async saveProductMarketplace(
    product: ProductDocument,
    marketplace: any,
    externalId: string,
    marketplaceData?: Record<string, any>
  ): Promise<any> {
    // Temporarily disabled - needs ProductService refactor
    this.logger.warn('saveProductMarketplace temporarily disabled - needs refactoring');
    return {};
  }

  private async updateProductMarketplace(productTitle: any): Promise<any> {
    // Temporarily disabled - needs ProductService refactor
    this.logger.warn('updateProductMarketplace temporarily disabled - needs refactoring');
    return {};
  }
}

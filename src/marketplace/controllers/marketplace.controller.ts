import { Controller, Get, Post, Body, Param, Put, Delete, Query, BadRequestException, ParseIntPipe, NotFoundException, Inject, forwardRef, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { MarketplaceService } from '../services/marketplace.service';
import { MarketplaceModel, MarketplaceDocument } from '../schemas/marketplace.schema';
import { MarketplaceToken } from '../schemas/marketplace-token.schema';
import { ProductModel, ProductTitle } from '../../product/schemas/product.schema';
import { MarketplaceAuthService } from '../auth/services/marketplace-auth.service';

import { ProductAttributesService } from '../services/product-attributes.service';

import { MarketplaceIntegrationHelperService } from '../services/marketplace-integration-helper.service';
// import { PublishService } from '../../publish/publish.service';
import { MarketplaceOrderService } from '../services/marketplace-order.service';
import { ProductService } from '../../product/product.service';
import { ProductTitleService } from '../../product/services/product-title.service';

import { CategoryService } from '../services/category.service';

import { MarketplaceAdapterRegistry } from '../registries/marketplace-adapter.registry';
import { MarketplaceIntegrationService } from '../services/marketplace-integration.service';
import { OrchestratorPublisherService } from '../../marketplace-orchestrator/orchestrator-publisher.service';

@ApiTags('marketplaces')
@Controller('marketplaces')
export class MarketplaceController {
  categoryAttributesService: any;
  logger: any;
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly marketplaceAuthService: MarketplaceAuthService,
    private readonly marketplaceIntegrationHelperService: MarketplaceIntegrationHelperService,
    private readonly categoryService: CategoryService,
    private readonly adapterRegistry: MarketplaceAdapterRegistry,

    private readonly productService: ProductService,
    private readonly productTitleService: ProductTitleService,
    private readonly productAttributesService: ProductAttributesService,
    // @Inject(forwardRef(() => PublishService))
    // private readonly publishService: PublishService,
    private readonly marketplaceOrderService: MarketplaceOrderService,

    // REPLACED: MarketplacePublicationService with Integration & Orchestrator
    private readonly marketplaceIntegrationService: MarketplaceIntegrationService,
    @Inject(forwardRef(() => OrchestratorPublisherService))
    private readonly orchestratorPublisherService: OrchestratorPublisherService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Listar todos os marketplaces' })
  @ApiResponse({ status: 200, description: 'Lista de marketplaces retornada com sucesso.' })
  async findAll(): Promise<MarketplaceDocument[]> {
    return this.marketplaceService.findAll();
  }

  @Get('ean13')
  async getEAN13() {
    return this.marketplaceIntegrationHelperService.generateEAN13();
  }

  @Get('validateProduct')
  @ApiOperation({ summary: 'Validar produto contra requisitos do marketplace' })
  @ApiResponse({ status: 200, description: 'Resultado da validação retornado com sucesso' })
  async validateProduct(
    @Query('productId') productId: string,
    @Query('marketplaceTag') marketplaceTag: string,
  ) {
    const product = await this.productService.findOne(productId);
    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }
    return this.marketplaceService.checkProductRequirements(
      product as ProductModel,
      marketplaceTag
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter um marketplace pelo ID' })
  @ApiResponse({ status: 200, description: 'Marketplace encontrado com sucesso' })
  @ApiResponse({ status: 404, description: 'Marketplace não encontrado' })
  async findOne(@Param('id') id: string): Promise<MarketplaceDocument> {
    return this.marketplaceService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar um novo marketplace' })
  @ApiResponse({ status: 201, description: 'Marketplace criado com sucesso' })
  async create(@Body() data: Partial<MarketplaceModel>): Promise<MarketplaceDocument> {
    return this.marketplaceService.create(data);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar um marketplace' })
  @ApiResponse({ status: 200, description: 'Marketplace atualizado com sucesso' })
  @ApiResponse({ status: 404, description: 'Marketplace não encontrado' })
  async update(@Param('id') id: string, @Body() data: Partial<MarketplaceModel>): Promise<MarketplaceDocument> {
    return this.marketplaceService.update(id, data);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir um marketplace' })
  @ApiResponse({ status: 200, description: 'Marketplace excluído com sucesso' })
  @ApiResponse({ status: 404, description: 'Marketplace não encontrado' })
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    await this.marketplaceService.remove(id);
    return { success: true, message: 'Marketplace excluído com sucesso' };
  }

  @Get(':id/requirements')
  @ApiOperation({ summary: 'Obter requisitos de um marketplace' })
  @ApiResponse({ status: 200, description: 'Requisitos retornados com sucesso' })
  async getRequirements(@Param('id') id: string): Promise<any> {
    return this.marketplaceService.getRequirements(id);
  }

  @Post(':id/requirements')
  @ApiOperation({ summary: 'Adicionar requisito ao marketplace' })
  @ApiResponse({ status: 201, description: 'Requisito adicionado com sucesso' })
  async addRequirement(
    @Param('id') id: string,
    @Body() data: any,
  ): Promise<any> {
    return this.marketplaceService.addRequirement(id, data);
  }

  @Put(':id/requirements/:requirementId')
  @ApiOperation({ summary: 'Atualizar requisito do marketplace' })
  @ApiResponse({ status: 200, description: 'Requisito atualizado com sucesso' })
  async updateRequirement(
    @Param('id') id: string,
    @Param('requirementId') requirementId: string,
    @Body() data: any,
  ): Promise<any> {
    return this.marketplaceService.updateRequirement(id, requirementId, data);
  }

  @Delete(':id/requirements/:requirementId')
  @ApiOperation({ summary: 'Excluir requisito do marketplace' })
  @ApiResponse({ status: 200, description: 'Requisito excluído com sucesso' })
  async removeRequirement(
    @Param('id') id: string,
    @Param('requirementId') requirementId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.marketplaceService.removeRequirement(id, requirementId);
    return { success: true, message: 'Requisito excluído com sucesso' };
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Obter marketplaces de um produto' })
  @ApiResponse({ status: 200, description: 'Marketplaces retornados com sucesso' })
  async getProductMarketplaces(@Param('productId', ParseIntPipe) productId: number): Promise<any> {
    return this.productTitleService.findByProductId(productId);
  }

  @Post('product/:productId/marketplace/:marketplaceId')
  @ApiOperation({ summary: 'Integrar produto com marketplace' })
  @ApiResponse({ status: 201, description: 'Produto integrado com marketplace com sucesso' })
  async createProductMarketplace(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('marketplaceId') marketplaceId: string,
    @Body() data: Partial<ProductTitle>,
  ): Promise<ProductTitle> {
    return this.productTitleService.upsertProductTitle(productId, marketplaceId, data);
  }

  @Put('product/:productId/marketplace/:marketplaceId')
  @ApiOperation({ summary: 'Atualizar integração do produto com marketplace' })
  @ApiResponse({ status: 200, description: 'Integração atualizada com sucesso' })
  async updateProductMarketplace(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('marketplaceId') marketplaceId: string,
    @Body() data: Partial<ProductTitle>,
    @Query('id', ParseIntPipe) id: number,
  ): Promise<ProductTitle> {
    const updateData: any = {};
    if (data.externalId) updateData.externalId = data.externalId;
    if (data.syncStatus) updateData.syncStatus = data.syncStatus === 'active' ? 'synced' : data.syncStatus;
    if (data.marketplaceData) updateData.marketplaceData = data.marketplaceData;
    if (marketplaceId) updateData.marketplaceId = marketplaceId;

    return this.productTitleService.update(id, updateData);
  }

  @Delete('product/:productId/marketplace/:marketplaceId')
  @ApiOperation({ summary: 'Remover integração do produto com marketplace' })
  @ApiResponse({ status: 200, description: 'Integração removida com sucesso' })
  async removeProductMarketplace(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('marketplaceId') marketplaceId: string,
    @Query('id', ParseIntPipe) id: number,
  ): Promise<{ success: boolean; message: string }> {
    if (id) {
      await this.productTitleService.remove(id);
    }
    return { success: true, message: 'Integração removida com sucesso' };
  }

  @Get('product/:productId/marketplace/:marketplaceId/status')
  @ApiOperation({ summary: 'Verificar status da integração do produto com marketplace' })
  @ApiResponse({ status: 200, description: 'Status retornado com sucesso' })
  async getProductMarketplaceStatus(
    @Param('productId', ParseIntPipe) productId: number,
    @Param('marketplaceId') marketplaceId: string,
  ): Promise<any> {
    return this.productTitleService.getMarketplaceStatus(productId, marketplaceId);
  }




  @Post('products/:productId/attributes')
  async saveProductAttributes(
    @Param('productId') productId: string,
    @Body() data: {
      marketplaceId?: string;
      externalCategory: string;
      internalCategoryId?: string; // Explicit override
      attributes: Array<{
        id: string;
        value: string;
        name?: string;
        marketplaceId?: string;
      }>;
      dimensions?: {
        height: number;
        width: number;
        length: number;
        weight: number;
      };
    },
  ) {
    try {
      // Buscar o produto (Documento Mongoose)
      const product = await this.productService.findDocument(productId);

      if (!product) {
        throw new Error('Produto não encontrado');
      }

      // Determine marketplace (Default to Mercado Livre ID 1 if not provided)
      const targetMarketplaceId = data.marketplaceId || '1'; // TODO: Replace '1' with actual default ObjectId if needed

      // Buscar o marketplace
      const marketplace = await this.marketplaceService.findOne(targetMarketplaceId);

      if (!marketplace) {
        throw new Error(`Marketplace com ID ${targetMarketplaceId} não encontrado`);
      }

      // Salvar os atributos
      await this.productAttributesService.saveProductAttributes(
        product as any,
        marketplace,
        data.externalCategory,
        data.attributes,
        data.dimensions,
        data.internalCategoryId
      );

      // Auto-publish (Legacy trigger removed)
      console.log(`[MarketplaceController] Attributes saved. Orchestrator should handle sync via Watcher if configured, or manual publish.`);

      return {
        success: true,
        message: 'Atributos salvos com sucesso'
      };
    } catch (error) {
      throw new Error(`Erro ao salvar atributos: ${error.message}`);
    }
  }

  @Get(':marketplaceId/categories/discovery')
  async domainDiscovery(
    @Query('title') title: string,
    @Param('marketplaceId') marketplaceId: string
  ) {
    return this.categoryService.domainDiscovery(marketplaceId, title);
  }

  @Get(':marketplaceId/categories/:categoryId')
  async getCategory(
    @Param('categoryId') categoryId: string,
    @Param('marketplaceId') marketplaceId: string
  ) {
    return this.categoryService.getCategory(marketplaceId, categoryId);
  }

  @Get(':marketplaceId/categories/:categoryId/attributes')
  async getCategoryAttributes(
    @Param('categoryId') categoryId: string,
    @Param('marketplaceId') marketplaceId: string
  ) {
    return this.categoryService.getCategoryAttributes(marketplaceId, categoryId);
  }

  @Get(':marketplaceId/categories/:categoryId/preferences')
  async getCategoryPreferences(
    @Param('marketplaceId') marketplaceId: string,
    @Param('categoryId') categoryId: string,
  ) {
    try {
      const marketplace = await this.marketplaceService.findAll().then(ms => ms.find(m => m.id.toString() === marketplaceId));
      if (!marketplace) return {}; // Not found

      const adapter = this.adapterRegistry.getCategoryAdapter(marketplace.name);

      if (adapter && (adapter as any).getCategoryPreferences) {
        return (adapter as any).getCategoryPreferences(categoryId);
      }
    } catch (error) {
      // Adapter not found or other error, just return empty
      return {};
    }

    return {};
  }

  @Get(':marketplaceId/categories/discovery/with-categories')
  async getDomainWithCategories(
    @Query('title') title: string,
    @Param('marketplaceId') marketplaceId: string
  ) {
    return this.categoryService.getDomainWithCategories(marketplaceId, title);
  }

  @Get(':marketplaceId/categories/discovery/with-category-and-attributes')
  async getDomainWithCategoryAndAttributes(
    @Query('title') title: string,
    @Param('marketplaceId') marketplaceId: string
  ) {
    return this.categoryService.getDomainWithCategoryAndAttributes(marketplaceId, title);
  }

  @Get(':marketplaceId/categories/:categoryId/attributes/with-values')
  async getCategoryAttributesWithValues(
    @Param('categoryId') categoryId: string,
    @Param('marketplaceId') marketplaceId: string,
    @Param('productId') productId: number
  ) {
    return this.categoryService.getCategoryAttributesWithValues(marketplaceId, productId, categoryId);
  }

  @Post('products/:productId/publish')
  async publishProduct(@Param('productId') productId: number, @Req() req: Request) {
    const user = (req as any).user;
    const userId = user?.sub || user?.userId || user?.id;
    // Forward to Orchestrator with User Context
    this.orchestratorPublisherService.requestSync({ productId: String(productId), reason: 'user_publish', force: true, requesterId: userId });
    return { success: true, message: 'Publicação iniciada via Orchestrator (Async)' };
  }

  @Get('all/orders')
  async getAllOrders(
    @Query('includeSyncStatus') includeSyncStatus?: string,
    @Query('syncStatus') syncStatus?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const params = {
      status: status,
      syncStatus: syncStatus,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      includeSyncStatus: includeSyncStatus === 'true'
    } as any;
    return this.marketplaceOrderService.getAllOrders(params);
  }

  @Get('all/listings')
  async getAllListings(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('marketplaceId') marketplaceId?: string,
    @Query('search') search?: string
  ) {
    const params = {
      status: status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      marketplaceId: marketplaceId,
      search: search
    } as any;
    // Use Integration Service
    return this.marketplaceIntegrationService.getAllListings(params);
  }

  @Get('mercadolivre/items/search')
  @ApiOperation({ summary: 'Proxy da busca ML GET /users/{seller}/items/search (offset/limit, máx. 50, tags opcional)' })
  async searchMercadoLivreItems(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('order') order?: string,
    @Query('tags') tags?: string,
  ) {
    return this.marketplaceIntegrationService.searchMercadoLivreUserItems({
      offset: offset !== undefined && offset !== '' ? parseInt(offset, 10) : 0,
      limit: limit !== undefined && limit !== '' ? parseInt(limit, 10) : 50,
      order,
      tags,
    });
  }

  @Get('mercadolivre/listings/items-search')
  @ApiOperation({
    summary:
      'Anúncios ML via GET /users/{seller}/items/search + multiget (tags opcional, ex. incomplete_compatibilities)',
  })
  async getMercadoLivreListingsItemsSearch(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('tags') tags?: string,
  ) {
    return this.marketplaceIntegrationService.getMercadoLivreListingsFromItemsSearch({
      offset: offset !== undefined && offset !== '' ? parseInt(offset, 10) : 0,
      limit: limit !== undefined && limit !== '' ? parseInt(limit, 10) : 20,
      tags,
    });
  }

  @Get('mercadolivre/listings/without-compatibilities')
  @ApiOperation({ summary: 'Anúncios Mercado Livre cujo produto não tem compatibilidades (paginação + detalhe ML)' })
  async getMercadoLivreListingsWithoutCompatibilities(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.marketplaceIntegrationService.getMercadoLivreListingsWithoutCompatibilities({
      offset: offset !== undefined && offset !== '' ? parseInt(offset, 10) : 0,
      limit: limit !== undefined && limit !== '' ? parseInt(limit, 10) : 20,
      search,
    });
  }

  @Get(':marketplaceId/orders')
  async getOrders(
    @Param('marketplaceId') marketplaceId: string,
    @Query('includeSyncStatus') includeSyncStatus?: string,
    @Query('syncStatus') syncStatus?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const params = {
      status: status,
      syncStatus: syncStatus,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      includeSyncStatus: includeSyncStatus === 'true'
    } as any;
    return this.marketplaceOrderService.getOrders(marketplaceId, params);
  }

  @Post(':marketplaceId/orders/:orderId/ignore')
  @ApiOperation({ summary: 'Ignorar pedido (ocultar da lista)' })
  @ApiResponse({ status: 201, description: 'Pedido ignorado com sucesso' })
  async ignoreOrder(
    @Param('marketplaceId') marketplaceIdRaw: string,
    @Param('orderId') orderId: string,
  ) {
    // const marketplaceId = parseInt(marketplaceIdRaw, 10);
    if (!marketplaceIdRaw) {
      throw new BadRequestException(`Invalid marketplaceId: ${marketplaceIdRaw}`);
    }
    return this.marketplaceOrderService.ignoreOrder(marketplaceIdRaw, orderId);
  }

  @Post(':marketplaceId/orders/sync-movements')
  async syncOrdersToMovements(
    @Param('marketplaceId') marketplaceId: string,
    @Body() body: any
  ) {
    return this.marketplaceOrderService.syncOrdersToMovements(marketplaceId, body || {});
  }

  // attach-fiscal moved to OrderController (POST /marketplaces/:marketplaceId/orders/:orderId/attach-fiscal)
  // so the marketplace module no longer depends on the order module (cycle removed).

  @Get(':marketplaceId/listings')
  async getListings(
    @Param('marketplaceId') marketplaceId: string,
    @Query('ids') ids: string
  ) {
    // Use Integration Service
    return this.marketplaceIntegrationService.getListingsById(marketplaceId, ids);
  }

  @Post('listings/status')
  async getListingsStatus(@Body() body: { productIds: number[] }) {
    // Use Integration Service
    return this.marketplaceIntegrationService.getListingsStatus(body.productIds);
  }
}
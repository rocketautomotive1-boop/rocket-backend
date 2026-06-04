import { Controller, Get, Post, Body, Param, Put, Delete, ParseIntPipe, BadRequestException, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ProductCategoryService } from '../services/product-category.service';
import { CategoryModel } from '../schemas/category.schema';
import { CreateProductCategoryDto } from '../dto/create-product-category.dto';
import { UpdateProductCategoryDto } from '../dto/update-product-category.dto';
import { UpdateCategoryTreeDto } from '../dto/update-category-tree.dto';


@ApiTags('categories')
@Controller('categories')
export class ProductCategoryController {
  constructor(
    private readonly productCategoryService: ProductCategoryService,
  ) { }

  // Specific Routes MUST come before :id Routes
  @Post('suggest')
  @ApiOperation({ summary: 'Sugere metadados da categoria via IA' })
  async suggest(@Body() body: { tree: string[] }) {
    return this.productCategoryService.suggestMetadata(body.tree);
  }

  @Post('suggest-from-tree')
  @ApiOperation({ summary: 'Sugere categorias filhas existentes baseado em caminho e contexto do produto' })
  async suggestFromTree(@Body() body: {
    tree: string[];
    productContext?: { name?: string; partNumber?: string; description?: string }
  }) {
    return this.productCategoryService.suggestFromExistingTree(body.tree, body.productContext);
  }

  @Post('populate-children')
  @ApiOperation({ summary: 'Sugere e opcionalmente cria categorias filhas via IA' })
  async populateChildren(@Body() body: {
    tree: string[];
    autoCreate?: boolean;
    searchRefinement?: string;
  }) {
    return this.productCategoryService.suggestAndCreateChildren(body.tree, body.autoCreate, body.searchRefinement);
  }

  @Post('map-from-marketplace')
  @ApiOperation({ summary: 'Mapeia categoria do marketplace para estrutura Rocket usando IA' })
  async mapFromMarketplace(@Body() body: {
    marketplacePath: string;
    autoCreate?: boolean;
  }) {
    return this.productCategoryService.mapFromMarketplace(body.marketplacePath, body.autoCreate);
  }

  @Post('marketplace-by-tag/:marketplaceTag/import-external/:externalCategoryId')
  @ApiOperation({
    summary: 'Importar categoria do marketplace (ID externo) e refatorar na árvore Rocket via IA',
    description:
      'Resolve o marketplace pela tag, sincroniza a categoria na API (ex. Mercado Livre), mapeia com IA para a taxonomia interna (pais estruturais com aiReason "Structural Parent created by AI Refactor"), cria/atualiza `categories` e vincula marketplaceMappings na folha.',
  })
  async importMarketplaceExternalWithAiRefactor(
    @Param('marketplaceTag') marketplaceTag: string,
    @Param('externalCategoryId') externalCategoryId: string,
  ) {
    return this.productCategoryService.importMarketplaceExternalCategoryWithAiRefactor(
      marketplaceTag,
      externalCategoryId,
    );
  }

  @Post('ensure-from-ml/:marketplaceTag/:externalCategoryId')
  @ApiOperation({
    summary: 'Garante a categoria interna a partir do category_id do marketplace (idempotente)',
    description:
      'Se já houver mapping para o externalCategoryId (ex.: MLB264201), retorna o id existente (sem IA). ' +
      'Senão, importa a categoria do marketplace e mapeia via IA, retornando o id criado. Usado pelo ' +
      'auto-save de categoria do frontend quando o discovery traz o MLB mas não há categoria mapeada.',
  })
  async ensureFromMl(
    @Param('marketplaceTag') marketplaceTag: string,
    @Param('externalCategoryId') externalCategoryId: string,
    @Query('domain') domain?: string,
  ) {
    return this.productCategoryService.ensureCategoryFromMl(marketplaceTag, externalCategoryId, domain ?? 'autopecas');
  }

  @Get('debug-counts')
  async debugCounts() {
    // Return top 10 categories with highest productCount
    return this.productCategoryService.getDebugCounts();
  }

  @Post(':id/marketplace-mapping')
  @ApiOperation({ summary: 'Adiciona ou atualiza mapeamento de marketplace em uma categoria' })
  async addMarketplaceMapping(
    @Param('id') id: string,
    @Body() body: {
      marketplaceId: string;
      externalId: string;
      externalName: string;
      path: string;
    }
  ) {
    return this.productCategoryService.addMarketplaceMapping(id, body);
  }

  @Post('fix-tree')
  @ApiOperation({ summary: 'Corrigir estrutura da árvore de categorias e slugs' })
  async fixTree() {
    return this.productCategoryService.fixTree();
  }

  @Post('update-counts')
  @ApiOperation({ summary: 'Atualiza a contagem de produtos em cada categoria (cache)' })
  async updateCounts() {
    return this.productCategoryService.updateProductCounts();
  }



  @Get('autocomplete')
  @ApiOperation({ summary: 'Buscar categorias (Autocomplete ES)' })
  async autocomplete(@Query('q') query: string) {
    return this.productCategoryService.searchCategories(query);
  }

  @Post(':id/image')
  @ApiOperation({ summary: 'Upload de imagem da categoria' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiResponse({ status: 200, description: 'Imagem enviada com sucesso' })
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.productCategoryService.uploadImage(id, file);
  }

  @Get('es-tree')
  @ApiOperation({ summary: 'Obter árvore de categorias via Elasticsearch' })
  async getEsTree() {
    return this.productCategoryService.getEsTree();
  }

  @Get('tree')
  @ApiOperation({ summary: 'Obter árvore de categorias (Mongo)' })
  @ApiResponse({ status: 200, description: 'Árvore de categorias retornada com sucesso' })
  async getTree(): Promise<any[]> {
    return this.productCategoryService.getTree();
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Obter uma categoria pelo Slug (SEO)' })
  @ApiResponse({ status: 200, description: 'Categoria encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Categoria não encontrada' })
  async findBySlug(@Param('slug') slug: string): Promise<CategoryModel> {
    return this.productCategoryService.findBySlug(slug);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas as categorias' })
  @ApiResponse({ status: 200, description: 'Lista de categorias retornada com sucesso' })
  async findAll(): Promise<CategoryModel[]> {
    return this.productCategoryService.findAll();
  }

  // Generic :id Routes (Must be last)
  @Get(':id')
  @ApiOperation({ summary: 'Obter uma categoria pelo ID' })
  @ApiResponse({ status: 200, description: 'Categoria encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Categoria não encontrada' })
  async findOne(@Param('id') id: string): Promise<CategoryModel> {
    const category = await this.productCategoryService.findOne(id);
    if (!category) {
      throw new BadRequestException(`Categoria com ID ${id} não encontrada`);
    }
    return category;
  }

  @Post()
  @ApiOperation({ summary: 'Criar uma nova categoria' })
  @ApiResponse({ status: 201, description: 'Categoria criada com sucesso' })
  async create(@Body() createProductCategoryDto: CreateProductCategoryDto): Promise<CategoryModel> {
    return this.productCategoryService.create(createProductCategoryDto);
  }

  @Post('create-from-ai')
  @ApiOperation({ summary: 'Criar categoria a partir de sugestão da IA' })
  @ApiResponse({ status: 201, description: 'Categoria criada com sucesso a partir da IA' })
  async createFromAi(@Body() aiSuggestion: {
    synonyms?: string[];
    examples?: string[];
    usageGuide?: string;
    suggestedTree: string[];
    relevance?: number;
  }): Promise<CategoryModel> {
    // Extract the category name from the last item in suggestedTree
    const name = aiSuggestion.suggestedTree[aiSuggestion.suggestedTree.length - 1];

    return this.productCategoryService.createOrReturnExisting({
      name,
      synonyms: aiSuggestion.synonyms,
      examples: aiSuggestion.examples,
      usageGuide: aiSuggestion.usageGuide,
      suggestedTree: aiSuggestion.suggestedTree,
      relevance: aiSuggestion.relevance
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar uma categoria' })
  @ApiResponse({ status: 200, description: 'Categoria atualizada com sucesso' })
  @ApiResponse({ status: 404, description: 'Categoria não encontrada' })
  async update(
    @Param('id') id: string,
    @Body() updateProductCategoryDto: UpdateProductCategoryDto,
  ): Promise<any> {
    return this.productCategoryService.update(id, updateProductCategoryDto);
  }

  @Put(':id/tree')
  @ApiOperation({ summary: 'Atualizar árvore da categoria (Mover/Renomear via Path)' })
  @ApiResponse({ status: 200, description: 'Categoria atualizada com sucesso' })
  async updateTree(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryTreeDto,
  ): Promise<any> {
    return this.productCategoryService.updateTreeAndMetadata(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir uma categoria' })
  @ApiResponse({ status: 200, description: 'Categoria excluída com sucesso' })
  @ApiResponse({ status: 404, description: 'Categoria não encontrada' })
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    await this.productCategoryService.remove(id);
    return { success: true, message: 'Categoria excluída com sucesso' };
  }
}
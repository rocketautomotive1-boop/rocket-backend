import { Controller, Get, Post, Patch, Body, Param, Put, Delete, BadRequestException, UseInterceptors, UploadedFiles, Logger, Query, ClassSerializerInterceptor, HttpStatus, HttpException, HttpCode, Req, Inject, forwardRef } from '@nestjs/common';
import { Types } from 'mongoose';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiBearerAuth, ApiExtraModels, ApiQuery, ApiParam } from '@nestjs/swagger';
import { ProductService } from './product.service';
import { ProductModel } from './schemas/product.schema';
import { S3Service } from '../common/s3/s3.service';
import { detectImageMimeType } from '../common/utils/image-mime.util';
import 'multer';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductBrandService } from './services/product-brand.service';
import { PaginatedResponseDto, ProductFilterDto, ProductResponseDto, ProductStatus } from './dto/product-filter.dto';
import { ProductFilterService } from './services/product-filter.service';
import { ProductCategoryService } from './services/product-category.service';
import { ProductTitle } from './schemas/product.schema';

import { ProductTitleService } from './services/product-title.service';
import { ProductDiscoveryService } from './services/product-discovery.service';
import { SourceRefreshService } from './services/source-refresh.service';
import { parseSourceName } from './dto/source-refresh.dto';
import { ZodError } from 'zod';
import { CategorySnapshotService } from './services/category-snapshot.service';
import { CreateFromDiscoveryDto } from './dto/create-from-discovery.dto';
import { SearchService } from '../search/search.service';
// import { PublishService } from '../publish/publish.service';
// import { calculatePublishPriority } from '../queue/publish-priority';
import { BoxItemService } from './services/box-item.service';
import { BoxService } from './services/box.service';
import { PRICING_PORT, PricingPort } from '../pricing/ports/pricing.port';

@ApiTags('Products')
@UseInterceptors(ClassSerializerInterceptor)
@ApiBearerAuth()
@ApiExtraModels(ProductFilterDto, ProductResponseDto)
@Controller('products')
export class ProductController {
  private readonly logger = new Logger(ProductController.name);

  constructor(
    private readonly productService: ProductService,
    private readonly productBrandService: ProductBrandService,
    private readonly s3Service: S3Service,
    private readonly productFilterService: ProductFilterService,
    private readonly productCategoryService: ProductCategoryService,
    private readonly productTitleService: ProductTitleService,
    private readonly boxItemService: BoxItemService,
    private readonly boxService: BoxService,
    private readonly searchService: SearchService,
    private readonly discoveryService: ProductDiscoveryService,
    private readonly sourceRefreshService: SourceRefreshService,
    private readonly categorySnapshotService: CategorySnapshotService,
    @Inject(PRICING_PORT) private readonly pricing: PricingPort,
  ) { }

  @Post('pre-register')
  @ApiOperation({ summary: 'Pré-cadastro: cria produto draft e dispara discovery' })
  async preRegister(
    @Body() body: { partNumber: string; brandId: string },
    @Req() req: any,
  ): Promise<{ productId: string; status: string; jobId: string | null }> {
    if (!body.partNumber?.trim()) throw new BadRequestException('partNumber is required');
    if (!body.brandId?.trim()) throw new BadRequestException('brandId is required');

    const brand = await this.productBrandService.findOne(body.brandId);
    if (!brand) throw new BadRequestException('Brand not found');

    const product = await this.productService.create(
      {
        partNumber: body.partNumber.trim(),
        brand: { id: String((brand as any).id ?? (brand as any)._id), name: (brand as any).name, isGenuine: false },
      },
      req?.user?.sub,
    );

    const productId = String((product as any).id ?? (product as any)._id);

    let jobId: string | null = null;
    try {
      jobId = await this.discoveryService.startDiscovery({
        partNumber: body.partNumber.trim(),
        brand: (brand as any).name,
        productId,
      });
    } catch (e: any) {
      this.logger.warn(`[PreRegister] Discovery failed to start: ${e.message}`);
    }

    return { productId, status: 'draft', jobId };
  }

  @Post('discovery')
  @ApiOperation({ summary: 'Iniciar processo de descoberta de mercado' })
  async startDiscovery(
    @Body() body: {
      partNumber: string;
      brand?: string;
      isGenuine?: boolean;
      productId?: string;
      brandId?: string;
      force?: boolean;
    },
  ) {
    const jobId = await this.discoveryService.startDiscovery({
      partNumber: body.partNumber,
      brand: body.brand,
      productId: body.productId
    });

    return { jobId };
  }

  @Post('discovery-ms')
  @ApiOperation({ summary: 'Disparar descoberta via novo Microserviço' })
  async startDiscoveryMs(
    @Body() body: {
      partNumber: string;
      brand?: string;
      productId?: string;
    },
  ) {
    const jobId = await this.discoveryService.startDiscovery({
      partNumber: body.partNumber,
      brand: body.brand,
      productId: body.productId,
    });

    return { jobId };
  }

  @Post(':id/sources/:source/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Atualiza isoladamente UMA fonte de descoberta do produto (ex.: Menor Preço)' })
  @ApiParam({ name: 'source', enum: ['menorPreco', 'ml', 'serp'] })
  async refreshSource(
    @Param('id') id: string,
    @Param('source') source: string,
  ): Promise<{ jobId: string }> {
    let parsedSource;
    try {
      parsedSource = parseSourceName(source);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException(error.issues[0]?.message ?? 'Fonte inválida.');
      }
      throw error;
    }
    return this.sourceRefreshService.requestRefresh({ productId: id, source: parsedSource });
  }

  @Get('discovery/status/:jobId')
  @ApiOperation({ summary: 'Obter status de um job de descoberta' })
  async getStatus(@Param('jobId') jobId: string) {
    return await this.discoveryService.getStatus(jobId);
  }

  @Get('discovery/results/:productId')
  @ApiOperation({ summary: 'Obter resultados da descoberta de mercado para um produto' })
  async getDiscoveryResults(@Param('productId') productId: string) {
    return this.discoveryService.findByProductId(productId);
  }

  @Get('discovery/recent')
  @ApiOperation({ summary: 'Obter descobertas recentes (global)' })
  async getRecentDiscoveries() {
    return this.discoveryService.findRecent(20);
  }

  @Get('discovery/by-pn')
  @ApiOperation({ summary: 'Buscar discovery existente por partNumber + brandId' })
  @ApiQuery({ name: 'partNumber', required: true })
  @ApiQuery({ name: 'brandId', required: false })
  async getDiscoveryByPartNumber(
    @Query('partNumber') partNumber: string,
    @Query('brandId') brandId?: string,
  ) {
    if (!partNumber) throw new BadRequestException('partNumber é obrigatório');
    if (brandId && !Types.ObjectId.isValid(brandId)) {
      throw new BadRequestException('brandId inválido');
    }
    const discovery = await this.discoveryService.findByPartNumberAndBrand(partNumber, brandId);
    return { found: !!discovery, discovery: discovery ?? null };
  }

  @Post('from-discovery')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar produto rascunho a partir de um discovery' })
  async createFromDiscovery(
    @Body() dto: CreateFromDiscoveryDto,
  ): Promise<ProductModel> {
    return this.productService.createFromDiscovery(dto);
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Lookup read-only por partNumber + brandId — sem criação' })
  @ApiQuery({ name: 'partNumber', required: true })
  @ApiQuery({ name: 'brandId', required: true })
  @ApiQuery({ name: 'brandName', required: false })
  async lookupProduct(
    @Query('partNumber') partNumber: string,
    @Query('brandId') brandId: string,
    @Query('brandName') brandName?: string,
  ) {
    if (!partNumber || !brandId) {
      throw new BadRequestException('partNumber e brandId são obrigatórios');
    }
    const product = await this.productService.lookup(partNumber, brandId, brandName);
    if (!product) {
      return { found: false, product: null };
    }
    return { found: true, product };
  }

  @Get('elastic')
  @ApiOperation({
    summary: 'Busca via Elasticsearch',
    description: 'Endpoint para busca semântica/fuzzy usando Elasticsearch.'
  })
  @ApiResponse({
    status: 200,
    description: 'Resultados da busca'
  })
  @ApiQuery({
    name: 'q',
    required: true,
    type: String,
    description: 'Termo de busca',
    example: 'disco embreagem'
  })
  async searchElastic(
    @Query('q') searchTerm: string,
    @Query('brand') brand?: string[],
    @Query('category') category?: string[],
    @Query('categoryId') categoryId?: string[],
    @Query('minPrice') minPrice?: number,
    @Query('maxPrice') maxPrice?: number,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 40
  ) {
    if (!searchTerm && (!brand && !category && !categoryId)) {
      throw new BadRequestException('Termo de busca ou filtro obrigatório');
    }
    return this.searchService.search(searchTerm || '', {
      brand: Array.isArray(brand) ? brand : brand ? [brand] : undefined,
      category: Array.isArray(category) ? category : category ? [category] : undefined,
      categoryId: Array.isArray(categoryId) ? categoryId : categoryId ? [categoryId] : undefined,
      minPrice,
      maxPrice
    }, page, limit);
  }

  @Get('discovery/search')
  @ApiOperation({ summary: 'Buscar rascunhos de descoberta' })
  @ApiQuery({ name: 'q', required: true })
  async searchDiscoveries(@Query('q') term: string) {
    if (!term) return [];
    return this.discoveryService.search(term);
  }

  @Patch('discovery/:id/associate')
  @ApiOperation({ summary: 'Associar productId a um discovery existente' })
  async associateDiscovery(
    @Param('id') id: string,
    @Body() body: { productId: string },
  ) {
    if (!body.productId) throw new BadRequestException('productId is required');
    await this.discoveryService.associateProduct(id, body.productId);
    return { ok: true };
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Autocomplete de produtos (desabilitado - migração para MongoDB Search)' })
  @ApiQuery({ name: 'q', required: true })
  async autocomplete(@Query('q') term: string) {
    return [];
  }

  @Delete('elastic/index')
  @ApiOperation({ summary: 'Deletar índice do Elasticsearch (Reset)' })
  async deleteIndex() {
    return this.searchService.deleteIndex();
  }

  @Post('elastic/sync')
  @ApiOperation({ summary: 'Sincronizar todos os produtos para o Elasticsearch (Reindex Full)' })
  async syncAllProducts() {
    this.logger.log('Starting full reindex...');

    // 1. Delete and Recreate Index
    await this.searchService.deleteIndex().catch(() => { });
    await this.searchService.createIndex();

    // 2. Fetch all products (batching would be better but keeping simple for now)
    // We'll rely on ProductService to give us everything or use a cursor if available.
    // For MVP, assuming memory holds (or we can pagination). 
    // safer: limit to 2000 recent or active? User said "sync".
    // Let's index ALL.
    const products = await this.productService.findAllModels();

    // 3. Index loop
    let count = 0;
    for (const product of products) {
      await this.searchService.indexProduct(product);
      count++;
      if (count % 100 === 0) this.logger.log(`Indexed ${count} products...`);
    }

    this.logger.log(`Full reindex complete. Total: ${count}`);
    return { message: `Indexed ${count} products`, success: true };
  }



  @Get('debug-elastic/:id')
  @ApiOperation({ summary: 'Debug: Ver documento no Elastic' })
  async debugElastic(@Param('id') id: string) {
    const result = await this.searchService.search(id, {}); // Simple search to find it? No.
    // We need 'get' by ID.
    // SearchService doesn't expose 'get'.
    // Let's implement a quick get or just search by _id.
    const product = await this.searchService.search('', {});
    // Wait, let's expose specific get in SearchService or use a hack.
    // Better: Add a temporary method in SearchService 'getDocument(id)'

    // For now, let's assume I can add it to SearchService first.
    return { message: "Endpoint pending SearchService update" };
  }

  async create(@Body() createProductDto: CreateProductDto, @Req() req: any): Promise<ProductModel> {
    const userId = req.user?.userId || req.user?.id || 'system';
    const product = await this.productService.create(createProductDto, userId);
    return product;
  }
  async update(@Param('id') id: string, @Body() updateProductDto: any): Promise<ProductModel> {
    const product = await this.productService.update(id, updateProductDto);
    return product;
  }














  @Get('recent')
  @ApiOperation({
    summary: 'Buscar produtos recentes',
    description: 'Retorna os últimos produtos modificados ou criados.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos recentes',
    type: [ProductModel]
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Página (padrão: 1)',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Limite de produtos (padrão: 5)',
    example: 5
  })
  async getRecentProducts(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 5
  ): Promise<ProductModel[]> {
    try {
      // Se limit foi passado mas page não, e limit > 50 (possível bug de client antigo enviando limit como primeiro param), 
      // poderíamos tratar, mas vamos assumir que o client envia query params nomeados corretamente.
      // O problema anterior era que findRecent(limit) assumia limit como page.
      return await this.productService.findRecent(page, limit);
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao buscar produtos recentes',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Listar produtos com filtros avançados',
    description: `
    Endpoint para buscar produtos com filtros avançados e relacionamentos.
    
    Suporta filtros por:
    - Dados básicos do produto (nome, partNumber, status, etc.)
    - Marca (ID, nome, shortName)
    - Categoria (ID, nome, incluindo subcategorias)
    - Inventário (quantidade, preço, localização, estoque)
    - Marketplace (ID, nome, habilitado)
    - Imagens (produtos com/sem imagens, quantidade mínima)
    - Atributos dinâmicos (código, valor, tipo)
    - Busca textual geral
    
    Inclui paginação, ordenação e opções para incluir relacionamentos na resposta.
    `
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos filtrados com paginação',
    type: ProductResponseDto
  })
  @ApiResponse({
    status: 400,
    description: 'Parâmetros de filtro inválidos'
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno do servidor'
  })
  // Documentação detalhada dos query parameters
  @ApiQuery({ name: 'ids', required: false, type: [Number], description: 'IDs dos produtos' })
  @ApiQuery({ name: 'name', required: false, type: String, description: 'Nome do produto (busca parcial)' })
  @ApiQuery({ name: 'partNumber', required: false, type: String, description: 'Número da peça' })
  @ApiQuery({ name: 'gtin', required: false, type: String, description: 'Código GTIN' })
  @ApiQuery({ name: 'status', required: false, enum: ProductStatus, isArray: true, description: 'Status do produto' })
  @ApiQuery({ name: 'isGenuine', required: false, type: Boolean, description: 'Apenas produtos genuínos' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Busca textual geral' })
  @ApiQuery({ name: 'includeBrand', required: false, type: Boolean, description: 'Incluir dados da marca' })
  @ApiQuery({ name: 'includeCategory', required: false, type: Boolean, description: 'Incluir dados da categoria' })
  @ApiQuery({ name: 'includeInventory', required: false, type: Boolean, description: 'Incluir dados do inventário' })
  @ApiQuery({ name: 'includeImages', required: false, type: Boolean, description: 'Incluir imagens' })
  @ApiQuery({ name: 'includeTitles', required: false, type: Boolean, description: 'Incluir títulos' })
  @ApiQuery({ name: 'includeAttributes', required: false, type: Boolean, description: 'Incluir atributos' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Página (começando em 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Itens por página (máx 100)' })
  @ApiQuery({ name: 'sortField', required: false, type: String, description: 'Campo para ordenação' })
  @ApiQuery({ name: 'sortDirection', required: false, enum: ['ASC', 'DESC'], description: 'Direção da ordenação' })
  async findProducts(@Query() filters: ProductFilterDto): Promise<PaginatedResponseDto<ProductModel>> {
    try {
      // Se há termo de busca, usar busca inteligente
      if (filters.search && filters.search.trim()) {
        return await this.productFilterService.findProductsIntelligent(
          filters.search.trim(),
          {
            page: filters.page || 1,
            limit: filters.limit || 20,
            includeBrand: filters.includeBrand !== false,
            includeCategory: filters.includeCategory !== false,
            includeImages: filters.includeImages !== false,
            includeInventory: filters.includeInventory !== false,
            includeTitles: filters.includeTitles !== false
          }
        );
      }

      // Caso contrário, usar busca normal
      return await this.productFilterService.findProducts(filters);
    } catch (error) {

      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao buscar produtos',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('filter')
  @ApiOperation({
    summary: 'Listar produtos com filtros avançados (via POST)',
    description: 'Endpoint para buscar produtos com filtros avançados e relacionamentos, aceitando filtros no corpo da requisição.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos filtrados com paginação',
    type: ProductResponseDto
  })
  @ApiResponse({
    status: 400,
    description: 'Parâmetros de filtro inválidos'
  })
  @ApiResponse({
    status: 500,
    description: 'Erro interno do servidor'
  })
  async filterProducts(
    @Body() filters: ProductFilterDto
  ): Promise<PaginatedResponseDto<ProductModel>> {
    try {
      // Se há termo de busca, usar busca inteligente
      if (filters.search && filters.search.trim()) {
        return await this.productFilterService.findProductsIntelligent(
          filters.search.trim(),
          {
            page: filters.page || 1,
            limit: filters.limit || 20,
            includeBrand: filters.includeBrand !== false,
            includeCategory: filters.includeCategory !== false,
            includeImages: filters.includeImages !== false,
            includeInventory: filters.includeInventory !== false,
            includeTitles: filters.includeTitles !== false
          }
        );
      }

      // Caso contrário, usar busca normal
      return await this.productFilterService.findProducts(filters);
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao buscar produtos',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('by-attributes')
  @ApiOperation({
    summary: 'Buscar produtos por atributos específicos',
    description: 'Busca produtos que possuem todos os atributos especificados com os valores exatos.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos que correspondem aos atributos',
    type: [ProductModel]
  })
  @ApiQuery({
    name: 'attributes',
    required: true,
    type: String,
    description: 'JSON com atributos no formato {"codigo": "valor", "codigo2": "valor2"}',
    example: '{"BRAND": "Fiat", "ORIGIN": "97214"}'
  })
  async findProductsByAttributes(
    @Query('attributes') attributesJson: string
  ): Promise<ProductModel[]> {
    try {
      const attributes = JSON.parse(attributesJson);
      return await this.productFilterService.findProductsByAttributes(attributes);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'JSON de atributos inválido',
            message: 'O parâmetro attributes deve ser um JSON válido',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao buscar produtos por atributos',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('low-stock')
  @ApiOperation({
    summary: 'Buscar produtos com estoque baixo',
    description: 'Retorna produtos com quantidade em estoque menor ou igual ao limite especificado.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos com estoque baixo',
    type: [ProductModel]
  })
  @ApiQuery({
    name: 'threshold',
    required: false,
    type: Number,
    description: 'Limite de estoque (padrão: 5)',
    example: 5
  })
  async findLowStockProducts(
    @Query('threshold') threshold: number = 5
  ): Promise<ProductModel[]> {
    try {
      return await this.productFilterService.findLowStockProducts(threshold);
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao buscar produtos com estoque baixo',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('without-images')
  @ApiOperation({
    summary: 'Buscar produtos sem imagens',
    description: 'Retorna produtos que não possuem imagens cadastradas.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de produtos sem imagens',
    type: [ProductModel]
  })
  async findProductsWithoutImages(): Promise<ProductModel[]> {
    try {
      return await this.productFilterService.findProductsWithoutImages();
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao buscar produtos sem imagens',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Obter estatísticas de produtos',
    description: 'Retorna estatísticas gerais sobre os produtos cadastrados.'
  })
  @ApiResponse({
    status: 200,
    description: 'Estatísticas dos produtos',
    schema: {
      type: 'object',
      properties: {
        total: { type: 'number', description: 'Total de produtos' },
        active: { type: 'number', description: 'Produtos ativos' },
        withImages: { type: 'number', description: 'Produtos com imagens' },
        withStock: { type: 'number', description: 'Produtos com estoque' },
        byBrand: {
          type: 'array',
          description: 'Produtos por marca',
          items: {
            type: 'object',
            properties: {
              brandName: { type: 'string' },
              count: { type: 'number' }
            }
          }
        },
        byCategory: {
          type: 'array',
          description: 'Produtos por categoria',
          items: {
            type: 'object',
            properties: {
              categoryName: { type: 'string' },
              count: { type: 'number' }
            }
          }
        }
      }
    }
  })
  async getProductStats(): Promise<any> {
    try {
      return await this.productFilterService.getProductStats();
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao obter estatísticas',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }



  @Get('search')
  @ApiOperation({
    summary: 'Busca rápida de produtos',
    description: 'Endpoint simplificado para busca rápida por texto em nome, partNumber e descrição.'
  })
  @ApiResponse({
    status: 200,
    description: 'Resultados da busca',
    type: ProductResponseDto
  })
  @ApiQuery({
    name: 'q',
    required: true,
    type: String,
    description: 'Termo de busca',
    example: 'disco embreagem'
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Página (padrão: 1)',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Itens por página (padrão: 10)',
    example: 10
  })
  async searchProducts(
    @Query('q') searchTerm: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10
  ): Promise<PaginatedResponseDto<ProductModel>> {
    try {
      if (!searchTerm || searchTerm.trim().length === 0) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Termo de busca obrigatório',
            message: 'O parâmetro q é obrigatório e não pode estar vazio',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const filters: ProductFilterDto = {
        search: searchTerm.trim(),
        pagination: { page, limit },
        includeBrand: true,
        includeCategory: true,
        includeImages: true
      };

      return await this.productFilterService.findProducts(filters);
    } catch (error) {

      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro na busca de produtos',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('search/compatibility')
  @ApiOperation({
    summary: 'Buscar produtos por compatibilidade',
    description: 'Busca produtos por palavras-chave nas compatibilidades de forma otimizada, sem carregar todos os dados das compatibilidades.'
  })
  @ApiResponse({
    status: 200,
    description: 'Produtos encontrados por compatibilidade',
    type: ProductResponseDto
  })
  @ApiQuery({
    name: 'keywords',
    required: true,
    type: String,
    description: 'Palavras-chave para busca (ex: "Fiat Strada 2022")',
    example: 'Fiat Strada 2022'
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Página (padrão: 1)',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Itens por página (padrão: 20)',
    example: 20
  })
  @ApiQuery({
    name: 'includeBrand',
    required: false,
    type: Boolean,
    description: 'Incluir dados da marca',
    example: true
  })
  @ApiQuery({
    name: 'includeCategory',
    required: false,
    type: Boolean,
    description: 'Incluir dados da categoria',
    example: true
  })
  @ApiQuery({
    name: 'includeImages',
    required: false,
    type: Boolean,
    description: 'Incluir imagens',
    example: true
  })
  @ApiQuery({
    name: 'includeInventory',
    required: false,
    type: Boolean,
    description: 'Incluir dados do inventário',
    example: true
  })
  async searchByCompatibility(
    @Query('keywords') keywords: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('includeBrand') includeBrand: boolean = true,
    @Query('includeCategory') includeCategory: boolean = true,
    @Query('includeImages') includeImages: boolean = true,
    @Query('includeInventory') includeInventory: boolean = true
  ): Promise<PaginatedResponseDto<ProductModel>> {
    try {
      if (!keywords || keywords.trim().length === 0) {
        throw new HttpException(
          {
            status: HttpStatus.BAD_REQUEST,
            error: 'Palavras-chave obrigatórias',
            message: 'O parâmetro keywords é obrigatório e não pode estar vazio',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      /*
  @Post('compatibility/keywords/search')
   async findByCompatKeywords(
      @Body() filters: any
   ) {
      // return await this.productFilterService.findProductsByCompatibilityKeywords(filters);
      return [];
   }
   */
      return await this.productFilterService.findProductsByCompatibilityKeywords(
        keywords.trim(),
        {
          page,
          limit,
          includeBrand,
          includeCategory,
          includeImages,
          includeInventory
        }
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro na busca por compatibilidade',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('filters/brands')
  @ApiOperation({
    summary: 'Obter lista de marcas para filtros',
    description: 'Retorna lista de marcas disponíveis para uso em filtros.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de marcas',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          shortName: { type: 'string' },
          productCount: { type: 'number' }
        }
      }
    }
  })
  async getBrandsForFilter(): Promise<any[]> {
    try {
      // Esta implementação seria feita no service
      // Retornando exemplo para demonstração
      return [
        { id: 1, name: 'Fiat', shortName: 'FCA', productCount: 150 },
        { id: 2, name: 'Volkswagen', shortName: 'VW', productCount: 200 }
      ];
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao obter marcas',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('filters/categories')
  @ApiOperation({
    summary: 'Obter lista de categorias para filtros',
    description: 'Retorna lista de categorias disponíveis para uso em filtros.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de categorias',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
          parentId: { type: 'string', nullable: true },
          productCount: { type: 'number' }
        }
      }
    }
  })
  async getCategoriesForFilter(): Promise<any[]> {
    try {
      // Buscar todas as categorias ativas do banco de dados
      const categories = await this.productCategoryService.findAll();

      // Para cada categoria, contar quantos produtos ela possui
      const categoriesWithCount = await Promise.all(
        categories.map(async (category) => {
          // Contar produtos desta categoria
          const productCount = await this.productService.countByCategory(category.id);

          return {
            id: category.id,
            name: category.name,
            parentId: category.parentId ? category.parentId.toString() : null,
            productCount: productCount
          };
        })
      );

      // Filtrar apenas categorias que têm produtos e ordenar por nome
      const filteredCategories = categoriesWithCount
        .filter(category => category.productCount > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      return filteredCategories;
    } catch (error) {
      this.logger.error('Erro ao obter categorias para filtro:', error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao obter categorias',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/inventory')
  @ApiOperation({ summary: 'Obter inventário do produto' })
  async getInventory(@Param('id') id: string) {
    return this.productService.getInventory(id);
  }

  @Get(':id/images')
  @ApiOperation({ summary: 'Obter imagens do produto' })
  async getImages(@Param('id') id: string) {
    return this.productService.getImages(id);
  }

  @Get(':id/category')
  @ApiOperation({ summary: 'Obter categoria do produto' })
  async getCategory(@Param('id') id: string) {
    return this.productService.getCategory(id);
  }

  @Get(':id/compatibilities')
  @ApiOperation({ summary: 'Obter compatibilidades do produto' })
  async getCompatibilities(@Param('id') id: string) {
    return this.productService.getCompatibilities(id);
  }

  @Get(':id/attributes')
  @ApiOperation({ summary: 'Obter atributos e dados fiscais do produto' })
  async getAttributes(@Param('id') id: string) {
    return this.productService.getAttributes(id);
  }

  @Post()
  @ApiTags('Products')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar um novo produto' })
  @ApiResponse({ status: 201, description: 'Produto criado com sucesso' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not Found' })
  @ApiResponse({ status: 405, description: 'Method Not Allowed' })
  async createProduct(@Body() createProductDto: CreateProductDto): Promise<ProductModel> {
    this.logger.debug('Dados recebidos:', createProductDto);

    if (!createProductDto.brandId) {
      throw new BadRequestException('brandId é obrigatório');
    }

    // Buscar a marca completa
    const brand = await this.productBrandService.findOne(String(createProductDto.brandId));
    if (!brand) {
      throw new BadRequestException('Marca não encontrada');
    }

    return this.productService.create({
      partNumber: createProductDto.partNumber,
      brand: brand,
      barcode: createProductDto.barcode,
      isGenuine: typeof createProductDto.isGenuine === 'number' ? createProductDto.isGenuine : undefined
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar um produto' })
  @ApiResponse({ status: 200, description: 'Produto atualizado com sucesso' })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  async updateProduct(
    @Param('id') id: string,
    @Body() updateProductDto: any,
  ): Promise<ProductModel> {
    try {
      if (updateProductDto.brand && typeof updateProductDto.brand === 'string') {
        const brand = await this.productBrandService.findOne(updateProductDto.brand);
        if (!brand) {
          throw new BadRequestException('Marca não encontrada');
        }
        updateProductDto.brand = brand;
      }

      const updatedProduct = await this.productService.update(id, updateProductDto);

      // Auto-publish removed: handled by ProductService sync queue
      // this.triggerAutoPublish(id, 'update');

      return updatedProduct;
    } catch (error) {
      this.logger.error(`Erro ao atualizar produto ${id}:`, error);
      throw error;
    }
  }

  @Post(':id/details')
  @ApiOperation({ summary: 'Atualizar detalhes específicos do produto (sem side-effects pesados)' })
  @ApiResponse({ status: 200, description: 'Detalhes atualizados com sucesso' })
  async updateProductDetails(
    @Param('id') id: string,
    @Body() data: any,
  ): Promise<void> {
    try {
      // Use POST/PATCH for partial updates on details
      await this.productService.updateDetails(id, data);
    } catch (error) {
      this.logger.error(`Erro ao atualizar detalhes do produto ${id}:`, error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao atualizar detalhes',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/images')
  @ApiOperation({ summary: 'Fazer upload de imagens para um produto' })
  @ApiResponse({ status: 200, description: 'Imagens enviadas com sucesso' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: any[],
    @Body() body: any,
  ): Promise<ProductModel> {
    const keptImagesRaw = body.keptImages;
    let keptImages: any[] = [];

    try {
      if (keptImagesRaw) {
        keptImages = typeof keptImagesRaw === 'string' ? JSON.parse(keptImagesRaw) : keptImagesRaw;
      }
    } catch (e) {
      this.logger.warn(`Erro ao fazer parse de keptImages: ${e.message}`);
    }

    if ((!files || files.length === 0) && keptImages.length === 0) {
      throw new BadRequestException('Nenhuma imagem enviada');
    }

    this.logger.log(`[DEBUG] Processing uploadImages for ${id}. Files: ${files?.length}, Kept: ${keptImages.length}`);

    // Buscar o produto para verificar se existe
    const product = await this.productService.findOne(id);
    if (!product) {
      throw new BadRequestException(`Produto com ID ${id} não encontrado`);
    }

    // Processar imagens mantidas para recuperar chaves perdidas (legacy)
    const processedKeptImages = keptImages.map(img => {
      if (!img.key && img.url) {
        const match = img.url.match(/(products\/[^/]+\/.+)/);
        if (match && match[1]) {
          this.logger.log(`Recuperada chave S3 da URL para imagem: ${match[1]}`);
          return { ...img, key: match[1] };
        }
      }
      return img;
    });

    // Chaves das imagens que devem ser mantidas no S3
    const keptKeys = processedKeptImages.map(img => img.key).filter(k => !!k);
    const newKeys: string[] = [];
    const uploadedFiles: any[] = [];

    // Fazer upload de cada nova imagem para o S3.
    // Detecta MIME real pelos magic bytes do buffer — ignora originalname/mimetype enviados pelo cliente
    // (mobile força 'image.png'/'image/png' mesmo para JPEG vindo de suggestedImages do Discovery).
    if (files && files.length > 0) {
      for (const file of files) {
        const detected = detectImageMimeType(file.buffer);
        if (detected.mime === 'application/octet-stream') {
          throw new BadRequestException(`Formato de imagem não suportado (não é JPEG/PNG/WEBP/GIF): ${file.originalname}`);
        }
        const baseName = (file.originalname || `image-${Date.now()}`).replace(/\.[^.]+$/, '');
        const filename = `${baseName}.${detected.ext}`;
        const key = `products/${id}/${Date.now()}-${filename}`;
        const url = await this.s3Service.uploadFile(
          file.buffer,
          key,
          detected.mime,
          true
        );
        uploadedFiles.push({ url, key, filename, mimeType: detected.mime });
        newKeys.push(key);
      }
    }

    // The frontend only knows about images that were loaded when the screen opened.
    // Images added by other async flows (e.g. rembg commitBatch) after the screen loaded
    // are unknown to the frontend and must not be dropped.
    //
    // Strategy: build the final list by honouring the frontend's explicit ordering of the
    // keys it knows about, then appending any server-side images whose keys were NOT in the
    // frontend's payload (they arrived after the screen opened).
    const sentKeys = new Set([...keptKeys, ...newKeys]);
    const serverImages: any[] = (product as any).images ?? [];
    const serverOnlyImages = serverImages.filter(
      (img: any) => img.key && !sentKeys.has(img.key),
    );

    // Final list: frontend-ordered kept + new uploads + any server-only images the
    // frontend didn't see.
    const allImagesList = [...processedKeptImages, ...uploadedFiles, ...serverOnlyImages];

    // Sincronizar pasta do S3 — only clean up keys under the products/ prefix that were
    // explicitly removed by the frontend (i.e. in the server set but not in sentKeys and
    // not in serverOnlyImages).  We pass all keys we want to keep so syncFolder preserves them.
    const folderPrefix = `products/${id}`;
    const allKeysToKeep = [...keptKeys, ...newKeys, ...serverOnlyImages.map((img: any) => img.key).filter(Boolean)];
    await this.s3Service.syncFolder(folderPrefix, allKeysToKeep);

    // Atualizar o produto com a lista completa de imagens
    const updatedProduct = await this.productService.updateImages(id, allImagesList);

    // Auto-publish removed (GlobalWatcher handles it)
    // this.triggerAutoPublish(updatedProduct._id, 'uploadImages');

    return updatedProduct;
  }

  @Post(':id/titles')
  @ApiOperation({ summary: 'Atualizar títulos de um produto' })
  @ApiResponse({ status: 200, description: 'Títulos atualizados com sucesso' })
  async updateTitles(
    @Param('id') id: string,
    @Body() body: any, // Accept object wrapper
    @Req() req: any,
  ): Promise<ProductModel> {

    let titlesData = body;
    if (body && !Array.isArray(body) && body.titles) {
      titlesData = body.titles;
    }

    if (!titlesData || !Array.isArray(titlesData) || titlesData.length === 0) {
      console.error('[ProductController.updateTitles] BAD REQUEST: Invalid titles data:', JSON.stringify(body));
      console.error('[ProductController.updateTitles] Expected { titles: [...] } or [...] but got:', typeof body);
      if (typeof titlesData === 'string') console.error('[ProductController.updateTitles] titlesData is a string:', titlesData);

      throw new BadRequestException('Nenhum título enviado ou formato inválido (Payload incorreto - Cliente desatualizado?)');
    }

    // Buscar o produto para verificar se existe
    const product = await this.productService.findOne(id);
    if (!product) {
      throw new BadRequestException(`Produto com ID ${id} não encontrado`);
    }

    const userId = req?.user?.id || null;

    // Atualizar o produto com os novos títulos usando o serviço atualizado
    const updatedProduct = await this.productService.updateTitles(id, titlesData, userId);

    // Auto-publish removed (GlobalWatcher handles it)
    // this.triggerAutoPublish(updatedProduct._id, 'updateTitles');

    return updatedProduct;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir um produto' })
  @ApiResponse({ status: 200, description: 'Produto excluído com sucesso' })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    await this.productService.remove(id);
    return { success: true, message: 'Produto excluído com sucesso' };
  }



  @Put(':id/category')
  @ApiOperation({ summary: 'Atualizar a categoria de um produto' })
  @ApiResponse({ status: 200, description: 'Categoria atualizada com sucesso' })
  @ApiResponse({ status: 404, description: 'Produto ou categoria não encontrada' })
  async updateCategory(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateProductCategoryDto
  ): Promise<ProductModel> {
    const updatedProduct = await this.productService.updateCategory(id, updateCategoryDto);

    // Auto-publish removed: handled by ProductService sync queue
    // this.triggerAutoPublish(id, 'updateCategory');

    return updatedProduct;
  }

  @Get('barcode/:barcode')
  async getByBarcode(@Param('barcode') barcode: string): Promise<ProductModel> {
    return this.productService.findByBarcode(barcode);
  }

  @Get('search')
  async search(@Query('q') q: string): Promise<ProductModel[]> {
    return this.productService.searchByBarcodeOrName(q);
  }

  @Get(':id/similar')
  @ApiOperation({
    summary: 'Buscar produtos similares por compatibilidade',
    description: 'Busca produtos que compartilham compatibilidades com o produto especificado.'
  })
  @ApiResponse({
    status: 200,
    description: 'Produtos similares encontrados',
    type: [ProductModel]
  })
  @ApiParam({
    name: 'id',
    description: 'ID do produto base',
    example: 1
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Limite de produtos similares (padrão: 10)',
    example: 10
  })
  async getSimilarProducts(
    @Param('id') id: string,
    @Query('limit') limit: number = 5
  ): Promise<ProductModel[]> {
    try {
      // return await this.productFilterService.findSimilarProductsByCompatibility(id, { limit });
      return [];
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao buscar produtos similares',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/compatibility-stats')
  @ApiOperation({
    summary: 'Obter estatísticas de compatibilidade do produto',
    description: 'Retorna informações resumidas sobre as compatibilidades do produto sem carregar todos os dados.'
  })
  @ApiResponse({
    status: 200,
    description: 'Estatísticas de compatibilidade',
    schema: {
      type: 'object',
      properties: {
        totalCompatibilities: { type: 'number' },
        uniqueVehicles: { type: 'number' },
        brands: { type: 'array', items: { type: 'string' } },
        models: { type: 'array', items: { type: 'string' } },
        years: { type: 'array', items: { type: 'string' } },
        fuelTypes: { type: 'array', items: { type: 'string' } },
        transmissions: { type: 'array', items: { type: 'string' } }
      }
    }
  })
  @ApiParam({
    name: 'id',
    description: 'ID do produto',
    example: 1
  })
  async getCompatibilityStats(@Param('id') id: string) {
    try {
      return await this.productFilterService.getProductCompatibilityStats(id);
    } catch (error) {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Erro ao obter estatísticas de compatibilidade',
          message: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/category-snapshot')
  @ApiOperation({ summary: 'Snapshot consolidado de categoria + atributos ML para um produto' })
  async getCategorySnapshot(@Param('id') id: string) {
    return this.categorySnapshotService.buildForProduct(id);
  }

  @Get(':id/titles')
  @ApiOperation({ summary: 'Obter títulos de um produto' })
  @ApiResponse({ status: 200, description: 'Títulos encontrados com sucesso', type: [ProductTitle] })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  async getTitles(@Param('id') id: string): Promise<ProductTitle[]> {
    // Verificar se o produto existe
    const product = await this.productService.findOne(id);
    if (!product) {
      throw new BadRequestException(`Produto com ID ${id} não encontrado`);
    }

    // [REF] Fetch from service
    return this.productTitleService.findByProductId(id);
  }

  @Put(':id/titles/:titleId')
  @ApiOperation({ summary: 'Atualizar título específico do produto' })
  @ApiResponse({ status: 200, description: 'Título atualizado com sucesso' })
  async updateTitle(
    @Param('id') productId: string,
    @Param('titleId') titleId: string,
    @Body() updateData: Partial<ProductTitle>
  ): Promise<any> {
    const updatedProduct = await this.productService.updateTitle(productId, titleId, updateData);

    // this.triggerAutoPublish(productId, 'updateTitle');

    // [REF] Return specific title DTO
    return this.productTitleService.findById(titleId);
  }

  /*
    // Endpoints para associação com BoxItems
    @Post(':id/box-item')
    @ApiOperation({
      summary: 'Associar produto a um box através de BoxItem',
      description: 'Adiciona um produto a uma caixa com condição e quantidade'
    })
    @ApiResponse({ status: 201, description: 'Produto associado ao box com sucesso' })
    @ApiParam({ name: 'id', description: 'ID do produto' })
    async associateWithBoxItem(
      @Param('id', ParseIntPipe) productId: number,
      @Body() associateData: AssociateProductBoxItemDto
    ): Promise<BoxItem> {
      const boxItem = await this.productService.associateWithBoxItem(
        productId,
        associateData.boxId,
        associateData.conditionId,
        associateData.quantity
      );
  
      // Auto-publish (Inventory changed)
      this.triggerAutoPublish(productId, 'associateBoxItem');
  
      return boxItem;
    }
  
    @Delete('box-item/:boxItemId')
    @ApiOperation({
      summary: 'Remover produto de um box',
      description: 'Remove um produto de uma caixa (deleta BoxItem)'
    })
    @ApiResponse({ status: 200, description: 'Produto removido do box com sucesso' })
    @ApiParam({ name: 'boxItemId', description: 'ID do BoxItem' })
    async disassociateFromBoxItem(
      @Param('boxItemId') boxItemId: string
    ): Promise<void> {
      // Need to find projectId before delete to trigger auto-publish
      // Assuming simple disassociate doesn't return product ID easily, skip or fetch first?
      // Let's optimize: skip for now or fetch. 
      // Fetching boxItem to get product ID
      try {
        const boxItem = await this.productService.findBoxItemById(boxItemId);
        if (boxItem && boxItem.product) {
          await this.productService.disassociateFromBoxItem(boxItemId);
          this.triggerAutoPublish(boxItem.product.id, 'disassociateBoxItem');
          return;
        }
      } catch (e) { }
  
      return this.productService.disassociateFromBoxItem(boxItemId);
    }
  
    @Get('box/:boxId/products')
    @ApiOperation({
      summary: 'Buscar produtos por box',
      description: 'Retorna todos os produtos associados a um box específico através de BoxItems'
    })
    @ApiResponse({ status: 200, description: 'Produtos do box encontrados' })
    @ApiParam({ name: 'boxId', description: 'ID do box' })
    async findProductsByBox(
      @Param('boxId', ParseIntPipe) boxId: number
    ): Promise<Product[]> {
      return this.productService.findProductsByBox(boxId);
    }
  
    @Get(':id/box-items')
    @ApiOperation({
      summary: 'Buscar BoxItems de um produto',
      description: 'Retorna todos os BoxItems associados a um produto específico'
    })
    @ApiResponse({ status: 200, description: 'BoxItems do produto encontrados' })
    @ApiParam({ name: 'id', description: 'ID do produto' })
    async findBoxItemsByProduct(
      @Param('id', ParseIntPipe) productId: number
    ): Promise<BoxItem[]> {
      return this.productService.findBoxItemsByProduct(productId);
    }
  */

  @Get(':id/movements')
  @ApiOperation({
    summary: 'Buscar movimentos do produto',
    description: 'Retorna o histórico de movimentos do produto'
  })
  @ApiResponse({ status: 200, description: 'Movimentos do produto encontrados' })
  @ApiParam({ name: 'id', description: 'ID do produto' })
  async getMovements(@Param('id') productId: string) {
    return this.productService.getMovements(productId);
  }

  @Post(':id/movements')
  @ApiOperation({
    summary: 'Criar movimento de produto',
    description: 'Cria um novo movimento para o produto (entrada/saída)'
  })
  @ApiResponse({ status: 201, description: 'Movimento criado com sucesso' })
  @ApiParam({ name: 'id', description: 'ID do produto' })
  async createMovement(
    @Param('id') productId: string,
    @Body() movementData: any
  ) {
    const movement = await this.productService.createMovement(productId, movementData);

    return movement;
  }

  @Put(':id/movements/:movementId')
  @ApiOperation({
    summary: 'Atualizar movimento de produto',
    description: 'Atualiza um movimento existente do produto'
  })
  @ApiResponse({ status: 200, description: 'Movimento atualizado com sucesso' })
  @ApiParam({ name: 'id', description: 'ID do produto' })
  @ApiParam({ name: 'movementId', description: 'ID do movimento' })
  async updateMovement(
    @Param('id') productId: string,
    @Param('movementId') movementId: string,
    @Body() movementData: any
  ) {
    const movement = await this.productService.updateMovement(productId, movementId, movementData);

    return movement;
  }



  @Get(':id/box-items')
  @ApiOperation({ summary: 'Obter itens de caixa (localização) do produto' })
  async getBoxItems(@Param('id') id: string) {
    return this.boxService.getBoxItemsByProductId(id);
  }
  @Get(':id/completion')
  @ApiOperation({ summary: 'Obter status de preenchimento do produto para as abas' })
  @ApiResponse({ status: 200, description: 'Status retornado com sucesso' })
  async getCompletionStatus(@Param('id') id: string) {
    return this.productService.getProductCompletion(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter um produto pelo _id' })
  @ApiQuery({
    name: 'view',
    required: false,
    enum: ['lean', 'full'],
    description: 'lean: documento menor (sem imagens/draft, category sem ancestors). Omitir = full.',
  })
  @ApiResponse({ status: 200, description: 'Produto encontrado com sucesso', type: ProductModel })
  @ApiResponse({ status: 404, description: 'Produto não encontrado' })
  async findOne(
    @Param('id') id: string,
    @Query('view') view?: string,
  ): Promise<ProductModel> {
    const product = await this.productService.findOne(id, { lean: view === 'lean' });
    if (!product) {
      throw new BadRequestException(`Produto com ID ${id} não encontrado`);
    }
    const basePrice = await this.pricing.getBasePrice(id);
    return { ...(product as any), basePrice };
  }
}
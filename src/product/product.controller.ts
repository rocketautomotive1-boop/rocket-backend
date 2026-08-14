import { Controller, Get, Post, Patch, Body, Param, Put, Delete, BadRequestException, UseInterceptors, UploadedFiles, Logger, Query, HttpStatus, HttpException, HttpCode, Req, Inject, forwardRef } from '@nestjs/common';
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
import { PaginatedResponseDto, ProductFilterDto, ProductResponseDto, ProductStatus, CompatibilitySearchResponseDto } from './dto/product-filter.dto';
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
// import { PublishService } from '../publish/publish.service';
// import { calculatePublishPriority } from '../queue/publish-priority';
import { BoxItemService } from './services/box-item.service';
import { BoxService } from './services/box.service';
import { PRICING_PORT, PricingPort } from '../pricing/ports/pricing.port';
import { RembgEnqueueService } from '../gateways/rembg-enqueue.service';
import { rembgOptionsSchema } from '../gateways/rembg-options.schema';
import { imageSlotsSchema, ImageSlot } from './dto/image-slots.dto';
import { ProductVehicleSearchService } from './services/product-vehicle-search.service';
import { TitleCategoryHintService } from './services/title-category-hint.service';
import { ProductRailsService, ProductRailType, ProductRailItem } from './services/product-rails.service';
import { SkipJwtAuth } from '../auth/decorators/skip-jwt-auth.decorator';

@ApiTags('Products')
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
    private readonly titleCategoryHintService: TitleCategoryHintService,
    private readonly productTitleService: ProductTitleService,
    private readonly boxItemService: BoxItemService,
    private readonly boxService: BoxService,
    private readonly discoveryService: ProductDiscoveryService,
    private readonly sourceRefreshService: SourceRefreshService,
    private readonly categorySnapshotService: CategorySnapshotService,
    @Inject(PRICING_PORT) private readonly pricing: PricingPort,
    private readonly rembgEnqueueService: RembgEnqueueService,
    private readonly productVehicleSearchService: ProductVehicleSearchService,
    private readonly productRailsService: ProductRailsService,
  ) { }

  private toStringArray(value?: string | string[]): string[] | undefined {
    if (!value) return undefined;
    return Array.isArray(value) ? value : [value];
  }

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
      req?.user?.id ?? req?.user?.sub,
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

  @SkipJwtAuth()
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

  @Post('summaries')
  @ApiOperation({
    summary: 'Resumos de produtos em lote (id + nome + imagem principal)',
    description: 'Projeção mínima para badges/cards (ex.: notificações). Aceita { ids: string[] } e retorna [{ id, name, image }].'
  })
  @ApiResponse({ status: 200, description: 'Lista de resumos de produtos' })
  async getProductSummaries(
    @Body() body: { ids?: string[] }
  ): Promise<Array<{ id: string; name: string; image: string | null }>> {
    return this.productService.getSummariesByIds(body?.ids ?? []);
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



  @SkipJwtAuth()
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

  @SkipJwtAuth()
  @Get('search/compatibility')
  @ApiOperation({
    summary: 'Buscar produtos por compatibilidade',
    description: 'Busca produtos por palavras-chave nas compatibilidades de forma otimizada, sem carregar todos os dados das compatibilidades.'
  })
  @ApiResponse({
    status: 200,
    description: 'Produtos encontrados por compatibilidade, com facets de marca/categoria/preço',
    type: CompatibilitySearchResponseDto
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
    name: 'brandNames',
    required: false,
    type: [String],
    description: 'Filtrar por nomes de marca (facet selecionado)',
  })
  @ApiQuery({
    name: 'categoryNames',
    required: false,
    type: [String],
    description: 'Filtrar por nomes de categoria (facet selecionado)',
  })
  @ApiQuery({
    name: 'priceMin',
    required: false,
    type: Number,
    description: 'Preço mínimo',
  })
  @ApiQuery({
    name: 'priceMax',
    required: false,
    type: Number,
    description: 'Preço máximo',
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
  @ApiQuery({
    name: 'vehicleId',
    required: false,
    type: String,
    description: 'Filtra por veículo ativo da garagem (vehicleId de vehicle_compatibilities) — filtro rígido combinado ao texto livre',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['relevance', 'price_asc', 'price_desc'],
    description: 'Ordenação do resultado (padrão: relevance)',
  })
  async searchByCompatibility(
    @Query('keywords') keywords: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('brandNames') brandNames?: string | string[],
    @Query('categoryNames') categoryNames?: string | string[],
    @Query('priceMin') priceMin?: number,
    @Query('priceMax') priceMax?: number,
    @Query('includeBrand') includeBrand: boolean = true,
    @Query('includeCategory') includeCategory: boolean = true,
    @Query('includeImages') includeImages: boolean = true,
    @Query('includeInventory') includeInventory: boolean = true,
    @Query('vehicleId') vehicleId?: string,
    @Query('sort') sort?: 'relevance' | 'price_asc' | 'price_desc',
  ): Promise<CompatibilitySearchResponseDto> {
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

      return await this.productFilterService.findProductsByCompatibilityKeywords(
        keywords.trim(),
        {
          page: page ? Number(page) : 1,
          limit: limit ? Number(limit) : 20,
          brandNames: this.toStringArray(brandNames),
          categoryNames: this.toStringArray(categoryNames),
          priceMin: priceMin !== undefined ? Number(priceMin) : undefined,
          priceMax: priceMax !== undefined ? Number(priceMax) : undefined,
          includeBrand,
          includeCategory,
          includeImages,
          includeInventory,
          vehicleId,
          sort,
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

  @SkipJwtAuth()
  @Get('autocomplete')
  @ApiOperation({
    summary: 'Sugestões de type-ahead conforme o usuário digita (nome/displayName/código do produto)',
    description: 'Índice dedicado (edgeGram), separado da busca completa — resposta leve (sem facets/preço/paginação), pensada pra dropdown de busca. vehicleId opcional adiciona selo de compatibilidade + resumo de aplicações por sugestão.',
  })
  @ApiQuery({ name: 'q', required: true, type: String, description: 'Termo parcial digitado (mínimo 2 caracteres)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Máximo de sugestões (padrão: 8)' })
  @ApiQuery({ name: 'vehicleId', required: false, type: String, description: 'Veículo ativo da garagem — habilita compatibleWithVehicle por sugestão' })
  async autocomplete(
    @Query('q') q: string,
    @Query('limit') limit?: number,
    @Query('vehicleId') vehicleId?: string,
  ): Promise<Array<{
    id: string;
    slug?: string;
    label: string;
    partNumber: string;
    brand?: string;
    compatibleWithVehicle?: boolean;
    applicationsSummary?: string[];
  }>> {
    return this.productVehicleSearchService.autocomplete(q ?? '', limit ? Number(limit) : 8, vehicleId);
  }

  @SkipJwtAuth()
  @Get('rails/:railType')
  @ApiOperation({
    summary: 'Buscar produtos de um rail de recomendação da home',
    description: 'railType: universal | best-sellers | for-your-car | accessories-for-your-car | deals. for-your-car e accessories-for-your-car exigem vehicleId. Ordenado por relevanceScore.'
  })
  @ApiParam({ name: 'railType', enum: ['universal', 'best-sellers', 'for-your-car', 'accessories-for-your-car', 'deals'] })
  @ApiQuery({ name: 'vehicleId', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getProductRail(
    @Param('railType') railType: ProductRailType,
    @Query('vehicleId') vehicleId?: string,
    @Query('limit') limit?: number,
  ): Promise<ProductRailItem[]> {
    return this.productRailsService.getRail(railType, {
      vehicleId,
      limit: limit ? Number(limit) : 20,
    });
  }

  @SkipJwtAuth()
  @Get('by-vehicle')
  @ApiOperation({
    summary: 'Buscar produtos compatíveis com um veículo',
    description: 'Aceita vehicleId (registro específico de vehicle_compatibilities) OU make+model (família inteira). Inclui produtos isUniversalFit.'
  })
  @ApiQuery({ name: 'vehicleId', required: false, type: String })
  @ApiQuery({ name: 'make', required: false, type: String })
  @ApiQuery({ name: 'model', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findProductsByVehicle(
    @Query('vehicleId') vehicleId?: string,
    @Query('make') make?: string,
    @Query('model') model?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<PaginatedResponseDto<ProductModel>> {
    return this.productVehicleSearchService.findByVehicle({
      vehicleId,
      make,
      model,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get(':id/compatible-with/:vehicleId')
  @ApiOperation({
    summary: 'Checar compatibilidade de um produto com um veículo específico',
    description: 'Usado pela PDP para exibir aviso quando o produto não é compatível com o veículo ativo da garagem do cliente.'
  })
  async checkCompatibility(
    @Param('id') id: string,
    @Param('vehicleId') vehicleId: string,
  ): Promise<{ compatible: boolean }> {
    const compatible = await this.productVehicleSearchService.isCompatible(id, vehicleId);
    return { compatible };
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

  @Get('category-hint')
  @ApiOperation({
    summary: 'Sugerir categoria a partir do histórico de uso de um título curto',
    description: 'Consulta title_category_hints e retorna a categoria mais usada para o titleId informado, se houver.',
  })
  @ApiQuery({ name: 'titleId', required: true, type: String })
  async getCategoryHint(
    @Query('titleId') titleId: string,
  ): Promise<{ categoryId: string; categoryName: string; count: number } | null> {
    if (!titleId) return null;
    return this.titleCategoryHintService.suggestCategory(titleId);
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
  @UseInterceptors(FilesInterceptor('files', 20))
  async uploadImages(
    @Param('id') id: string,
    @UploadedFiles() files: any[],
    @Body() body: any,
  ): Promise<ProductModel> {
    // ── Ordered-slot contract ────────────────────────────────────────────────
    // The frontend list is the single source of truth. It sends ONE ordered array of
    // slots; the final product.images is assembled STRICTLY by slot.position. Every
    // subdoc carries a stable slotId (identity) so async rembg results reconcile into
    // the exact slot the user placed — the order is never re-derived by concatenation.
    let slots: ImageSlot[];
    try {
      const raw = typeof body.slots === 'string' ? JSON.parse(body.slots) : body.slots;
      slots = imageSlotsSchema.parse(raw);
    } catch (e: any) {
      if (e instanceof ZodError) {
        throw new BadRequestException(`Payload de imagens inválido: ${e.issues.map(i => i.message).join('; ')}`);
      }
      throw new BadRequestException('Payload de imagens inválido (slots ausente ou malformado)');
    }

    if (slots.length === 0) {
      throw new BadRequestException('Nenhuma imagem enviada');
    }

    // rembgOptions is optional — omitted/empty falls back to the schema's per-field
    // defaults (same values that used to be hardcoded below), so old clients that
    // never send this field keep working unchanged.
    let rembgOptions: ReturnType<typeof rembgOptionsSchema.parse>;
    try {
      const rawOptions = typeof body.rembgOptions === 'string' ? JSON.parse(body.rembgOptions) : body.rembgOptions;
      rembgOptions = rembgOptionsSchema.parse(rawOptions ?? {});
    } catch (e: any) {
      if (e instanceof ZodError) {
        throw new BadRequestException(`Opções de rembg inválidas: ${e.issues.map(i => i.message).join('; ')}`);
      }
      throw new BadRequestException('Opções de rembg malformadas');
    }

    const product = await this.productService.findOne(id);
    if (!product) {
      throw new BadRequestException(`Produto com ID ${id} não encontrado`);
    }

    // Upload every new binary to S3 once, indexed by fileIndex (real MIME via magic
    // bytes — the client forces image/png even for JPEG from Discovery suggestions).
    const uploadedByFileIndex = new Map<number, { url: string; key: string; filename: string; mimeType: string }>();
    const filesArr = files ?? [];
    for (let fi = 0; fi < filesArr.length; fi++) {
      const file = filesArr[fi];
      const detected = detectImageMimeType(file.buffer);
      if (detected.mime === 'application/octet-stream') {
        throw new BadRequestException(`Formato de imagem não suportado (não é JPEG/PNG/WEBP/GIF): ${file.originalname}`);
      }
      const baseName = (file.originalname || `image-${Date.now()}-${fi}`).replace(/\.[^.]+$/, '');
      const filename = `${baseName}.${detected.ext}`;
      const key = `products/${id}/${Date.now()}-${fi}-${filename}`;
      const url = await this.s3Service.uploadFile(file.buffer, key, detected.mime, true);
      uploadedByFileIndex.set(fi, { url, key, filename, mimeType: detected.mime });
    }

    const serverImages: any[] = (product as any).images ?? [];
    const serverBySlotId = new Map<string, any>(
      serverImages.filter((img: any) => img.slotId).map((img: any) => [img.slotId, img]),
    );

    // Assemble the final list strictly by position. `kind` decides how each slot resolves.
    const ordered = [...slots].sort((a, b) => a.position - b.position);
    const finalImages: any[] = [];
    const rembgToEnqueue: Array<{ slotId: string; file: any }> = [];

    const partNumber = (product as any).partNumber ?? '';
    const brandName = (product as any).brand?.name ?? '';
    const batchNote = [partNumber, brandName].filter(Boolean).join(' ').trim() || undefined;

    for (let position = 0; position < ordered.length; position++) {
      const slot = ordered[position];
      const main = position === 0;

      if (slot.kind === 'kept') {
        // Recover the S3 key from the URL for legacy rows that never stored one.
        let key = slot.key;
        if (!key && slot.url) {
          const match = slot.url.match(/(products\/[^/]+\/.+)/);
          if (match?.[1]) key = match[1];
        }
        const prev = serverBySlotId.get(slot.slotId);
        finalImages.push({
          slotId: slot.slotId,
          url: slot.url ?? prev?.url,
          key,
          mimeType: slot.mimeType ?? prev?.mimeType,
          order: position,
          main,
          status: 'active',
        });
      } else {
        // upload | pending — both reference a freshly uploaded binary by fileIndex.
        const uploaded = slot.fileIndex !== undefined ? uploadedByFileIndex.get(slot.fileIndex) : undefined;
        if (!uploaded) {
          throw new BadRequestException(`Slot ${slot.position} (${slot.kind}) sem arquivo correspondente (fileIndex ${slot.fileIndex})`);
        }
        if (slot.kind === 'upload') {
          finalImages.push({
            slotId: slot.slotId,
            url: uploaded.url,
            key: uploaded.key,
            mimeType: uploaded.mimeType,
            order: position,
            main,
            status: 'active',
          });
        } else {
          // pending → reserve a placeholder in place; rembg fills it by slotId later.
          finalImages.push({
            slotId: slot.slotId,
            url: uploaded.url,        // raw preview until processed
            key: uploaded.key,
            mimeType: uploaded.mimeType,
            order: position,
            main,
            status: 'processing',
          });
          rembgToEnqueue.push({ slotId: slot.slotId, file: filesArr[slot.fileIndex!] });
        }
      }
    }

    // S3 cleanup: keep every key referenced by the final list under products/.
    const folderPrefix = `products/${id}`;
    const keysToKeep = finalImages.map(img => img.key).filter(Boolean);
    await this.s3Service.syncFolder(folderPrefix, keysToKeep);

    const updatedProduct = await this.productService.updateImages(id, finalImages);

    // Enqueue rembg for reserved slots AFTER the slots exist on the product, so the
    // worker's positional $set always finds its slotId. One shared batchCode per save.
    //
    // DECOUPLED FROM THE SAVE: the images are already persisted. A dispatch failure
    // (e.g. broker unavailable) must NOT fail the save — that would leave the user
    // staring at "processando" with the request 500ing. Failed dispatches mark their
    // slot 'failed' so the UI can surface it and the user can retry, never silently.
    if (rembgToEnqueue.length > 0) {
      const batchCode = `RB-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      for (const { slotId, file } of rembgToEnqueue) {
        try {
          await this.rembgEnqueueService.enqueue({
            productId: id,
            slotId,
            fileBuffer: file.buffer,
            originalName: file.originalname || 'upload.jpg',
            mimeType: file.mimetype || 'image/jpeg',
            batchCode,
            batchNote,
            options: rembgOptions,
          });
        } catch (err: any) {
          this.logger.error(`Falha ao criar job rembg (slot ${slotId}): ${err?.message}`);
          await this.productService.markImageSlotFailed(id, slotId).catch(() => {});
        }
      }
    }

    return this.productService.findOne(id);
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
  async getCompletionStatus(@Param('id') id: string, @Req() req: any) {
    return this.productService.getProductCompletion(id, req?.user?.storeId ?? undefined);
  }

  @SkipJwtAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Obter um produto pelo _id ou slug (storefront)' })
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
    // view=lean só se aplica à busca por _id (rota interna); a busca por slug
    // (storefront) sempre retorna full — a PDP pública precisa dos campos completos.
    const product = view === 'lean' && Types.ObjectId.isValid(id)
      ? await this.productService.findOne(id, { lean: true })
      : await this.productService.findOneBySlugOrId(id);
    if (!product) {
      throw new BadRequestException(`Produto com ID ${id} não encontrado`);
    }
    const basePrice = await this.pricing.getBasePrice(String((product as any)._id ?? id));
    // price é mantido no shape de resposta por retrocompatibilidade — o schema
    // não tem mais esse campo (preço vive no PricingModule), mas clientes
    // antigos (app mobile) ainda leem product.price diretamente.
    return { ...(product as any), basePrice, price: basePrice };
  }
}
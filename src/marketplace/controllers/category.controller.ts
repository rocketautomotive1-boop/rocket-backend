import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CategoryService } from '../services/category.service';
import { MarketplaceService } from '../services/marketplace.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CreateCategoryMappingDto } from '../dto/create-category-mapping.dto';
import { UpdateCategoryMappingDto } from '../dto/update-category-mapping.dto';
import { Logger } from '@nestjs/common';

@ApiTags('categories')
@Controller('categories')
//@UseGuards(JwtAuthGuard)
//@ApiBearerAuth()
export class CategoryController {
  private readonly logger = new Logger(CategoryController.name);

  constructor(
    private readonly categoryService: CategoryService,
    private readonly marketplaceService: MarketplaceService, // Added injection
  ) { }

  @Get('attributes')
  @ApiOperation({ summary: 'Obter atributos de categoria para todos os marketplaces' })
  @ApiResponse({ status: 200, description: 'Lista de atributos de categoria retornada com sucesso' })
  async getCategoryAttributesForAllMarketplaces(@Query('categoryId') categoryId: string) {
    const marketplaces = await this.marketplaceService.findAll();

    const results = await Promise.all(
      marketplaces.map(async (marketplace) => {
        try {
          const attributes = await this.categoryService.getCategoryAttributes(
            marketplace.id.toString(),
            categoryId
          );

          return {
            marketplaceId: marketplace.id,
            marketplaceName: marketplace.name,
            attributes
          };
        } catch (error) {
          this.logger.warn(`Failed to get category attributes for marketplace ${marketplace.id}: ${error.message}`);
          // Skip marketplaces without category adapter or other errors
          return null;
        }
      })
    );

    // Filter out null results (marketplaces without adapters or errors)
    return results.filter(result => result !== null);
  }

  @Get('marketplace/:marketplaceId')
  @ApiOperation({ summary: 'Listar categorias de um marketplace' })
  @ApiResponse({ status: 200, description: 'Lista de categorias retornada com sucesso' })
  async findCategories(
    @Param('marketplaceId') marketplaceId: string,
    @Query('parentId') parentId?: string,
    @Query('query') query?: string,
  ) {
    return this.categoryService.findCategories(marketplaceId, parentId, query);
  }

  @Get('marketplace/:marketplaceId/category/:externalId')
  @ApiOperation({ summary: 'Obter categoria por ID externo' })
  @ApiResponse({ status: 200, description: 'Categoria encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Categoria não encontrada' })
  async findCategoryByExternalId(
    @Param('marketplaceId') marketplaceId: string,
    @Param('externalId') externalId: string,
  ) {
    return this.categoryService.findCategoryByExternalId(marketplaceId, externalId);
  }

  @Get('category/:id')
  @ApiOperation({ summary: 'Obter categoria por ID' })
  @ApiResponse({ status: 200, description: 'Categoria encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Categoria não encontrada' })
  async findCategoryById(@Param('id') id: string) {
    return this.categoryService.findCategoryById(id);
  }

  @Get('marketplace/:marketplaceId/category/:externalId/shipping-preferences')
  @ApiOperation({ summary: 'Obter preferências de envio da categoria' })
  @ApiResponse({ status: 200, description: 'Preferências retornadas com sucesso' })
  async getShippingPreferences(
    @Param('marketplaceId') marketplaceId: string,
    @Param('externalId') externalId: string,
  ) {
    return this.categoryService.getShippingPreferences(marketplaceId, externalId);
  }

  @Post('marketplace/:marketplaceId/sync')
  @ApiOperation({ summary: 'Sincronizar categorias de um marketplace' })
  @ApiResponse({ status: 200, description: 'Categorias sincronizadas com sucesso' })
  async syncCategories(
    @Param('marketplaceId') marketplaceId: string,
    @Query('parentId') parentId?: string,
  ) {
    return this.categoryService.syncCategories(marketplaceId, parentId);
  }

  @Post('mapping')
  @ApiOperation({ summary: 'Criar mapeamento de categoria' })
  @ApiResponse({ status: 201, description: 'Mapeamento criado com sucesso' })
  async createMapping(@Body() createMappingDto: CreateCategoryMappingDto) {
    return this.categoryService.createMapping(
      createMappingDto.marketplaceCategoryId,
      String(createMappingDto.internalCategoryId),
      createMappingDto.internalCategoryName,
      createMappingDto.internalCategoryPath,
      createMappingDto.attributeMappings,
      createMappingDto.externalId,
      createMappingDto.externalName,
    );
  }

  @Put('mapping/:id')
  @ApiOperation({ summary: 'Atualizar mapeamento de categoria' })
  @ApiResponse({ status: 200, description: 'Mapeamento atualizado com sucesso' })
  @ApiResponse({ status: 404, description: 'Mapeamento não encontrado' })
  async updateMapping(
    @Param('id') id: string,
    @Body() updateMappingDto: UpdateCategoryMappingDto,
  ) {
    return this.categoryService.updateMapping(
      id,
      updateMappingDto.marketplaceCategoryId,
      updateMappingDto.internalCategoryName,
      updateMappingDto.internalCategoryPath,
      updateMappingDto.attributeMappings,
      updateMappingDto.externalId,
      updateMappingDto.externalName,
    );
  }

  @Delete('mapping/:id')
  @ApiOperation({ summary: 'Excluir mapeamento de categoria' })
  @ApiResponse({ status: 200, description: 'Mapeamento excluído com sucesso' })
  @ApiResponse({ status: 404, description: 'Mapeamento não encontrado' })
  async deleteMapping(@Param('id') id: string) {
    const result = await this.categoryService.deleteMapping(id);
    return { success: result };
  }

  @Get('mapping/internal/:internalCategoryId')
  @ApiOperation({ summary: 'Buscar mapeamentos por categoria interna' })
  @ApiResponse({ status: 200, description: 'Lista de mapeamentos retornada com sucesso' })
  async findMappingsByInternalCategory(@Param('internalCategoryId') internalCategoryId: string) {
    return this.categoryService.findMappingsByInternalCategory(internalCategoryId);
  }

  @Get('mapping/internal/:internalCategoryId/marketplace/:marketplaceId')
  @ApiOperation({ summary: 'Buscar mapeamento por categoria interna e marketplace' })
  @ApiResponse({ status: 200, description: 'Mapeamento encontrado com sucesso' })
  @ApiResponse({ status: 404, description: 'Mapeamento não encontrado' })
  async findMappingByInternalCategoryAndMarketplace(
    @Param('internalCategoryId') internalCategoryId: string,
    @Param('marketplaceId') marketplaceId: string,
  ) {
    return this.categoryService.findMappingByInternalCategoryAndMarketplace(
      internalCategoryId,
      marketplaceId,
    );
  }

  @Get('mapping/marketplace-category/:marketplaceCategoryId')
  @ApiOperation({ summary: 'Buscar mapeamentos por categoria de marketplace' })
  @ApiResponse({ status: 200, description: 'Lista de mapeamentos retornada com sucesso' })
  async findMappingsByMarketplaceCategory(
    @Param('marketplaceCategoryId') marketplaceCategoryId: string,
  ) {
    return this.categoryService.findMappingsByMarketplaceCategory(marketplaceCategoryId);
  }

}

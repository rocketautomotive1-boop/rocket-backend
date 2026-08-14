import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ProductTitleService } from '../services/product-title.service';
import { CreateProductTitleDto, UpdateProductTitleDto, CreateProductTitlesBatchDto } from '../dto/product-title.dto';
import { ProductTitle } from '../product-types';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UpdateTitlesDto } from '../dto/update-titles.dto';
import { ListingRemovalService } from '../../marketplace-orchestrator/services/listing-removal.service';

@ApiTags('titles')
@Controller('titles')
@UseGuards(JwtAuthGuard)
export class ProductTitleController {
  constructor(
    private readonly productTitleService: ProductTitleService,
    private readonly listingRemovalService: ListingRemovalService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Listar todos os títulos de um produto' })
  @ApiResponse({ status: 200, description: 'Lista de títulos retornada com sucesso' })
  async findAll(@Query('productId') productId: number | string): Promise<ProductTitle[]> {
    return this.productTitleService.findByProductId(productId as any);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar um título específico' })
  @ApiResponse({ status: 200, description: 'Título encontrado com sucesso' })
  @ApiResponse({ status: 404, description: 'Título não encontrado' })
  async findOne(@Param('id') id: number | string): Promise<ProductTitle> {
    return this.productTitleService.findOne(id as any);
  }

  @Post()
  @ApiOperation({ summary: 'Criar um novo título' })
  @ApiResponse({ status: 201, description: 'Título criado com sucesso' })
  async create(
    @Query('productId') productId: number | string,
    @Body() createProductTitleDto: CreateProductTitleDto,
    @Req() req: any
  ): Promise<ProductTitle> {
    const userId = req?.user?.id || req?.user?.sub;
    const storeId = req?.user?.storeId ?? null;
    return this.productTitleService.create(productId as any, { ...createProductTitleDto, userId, storeId } as any);
  }

  @Post('batch')
  async updateTitles(@Body() updateTitlesDto: UpdateTitlesDto, @Req() req: any) {
    const userId = req?.user?.id || req?.user?.sub;
    const storeId = req?.user?.storeId ?? null;
    return this.productTitleService.updateTitles(
      updateTitlesDto.productId as any,
      updateTitlesDto.titles as any,
      userId,
      storeId
    );
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar um título' })
  @ApiResponse({ status: 200, description: 'Título atualizado com sucesso' })
  @ApiResponse({ status: 404, description: 'Título não encontrado' })
  async update(
    @Param('id') id: number | string,
    @Body() updateProductTitleDto: UpdateProductTitleDto
  ): Promise<ProductTitle> {
    return this.productTitleService.update(id as any, updateProductTitleDto as any);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover um título' })
  @ApiResponse({ status: 200, description: 'Título removido com sucesso' })
  @ApiResponse({ status: 403, description: 'Apenas admins podem remover títulos publicados' })
  @ApiResponse({ status: 404, description: 'Título não encontrado' })
  async remove(@Param('id') id: number | string, @Req() req: any): Promise<{ success: boolean; message: string; queued?: boolean; jobId?: string; warning?: string }> {
    // Check if listing is published — if so, require admin role and use removal service
    const listing = await this.productTitleService.findOne(id as any);
    if (listing && (listing as any).externalId) {
      const isAdmin = req.user?.roles?.includes('admin');
      if (!isAdmin) {
        throw new ForbiddenException('Apenas administradores podem remover títulos publicados');
      }
      const result = await this.listingRemovalService.removeListing(String(id), req.user?.id);
      return {
        success: true,
        message: result.warning || 'Remoção do anúncio solicitada ao marketplace',
        queued: result.queued,
        jobId: result.jobId,
        warning: result.warning,
      };
    }

    // Not published — any authenticated user can delete
    const success = await this.productTitleService.remove(id as any);
    return {
      success,
      message: success ? 'Título removido com sucesso' : 'Falha ao remover título'
    };
  }

  @Delete('product/:productId')
  @ApiOperation({ summary: 'Remover todos os títulos de um produto' })
  @ApiResponse({ status: 200, description: 'Títulos removidos com sucesso' })
  async removeAllByProductId(
    @Param('productId') productId: number | string
  ): Promise<{ success: boolean; message: string }> {
    const success = await this.productTitleService.removeAllByProductId(productId as any);
    return {
      success,
      message: success ? 'Títulos removidos com sucesso' : 'Falha ao remover títulos'
    };
  }
}
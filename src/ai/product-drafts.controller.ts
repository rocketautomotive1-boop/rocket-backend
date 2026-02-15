import { Controller, Get, Query, Param, ParseIntPipe, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ProductDraftsService } from './product-drafts.service';

@ApiTags('product-drafts')
@Controller('product-drafts')
export class ProductDraftsController {
  constructor(private readonly draftsService: ProductDraftsService) { }

  @Get()
  @ApiOperation({ summary: 'Listar rascunhos de produtos (AI)' })
  @ApiResponse({ status: 200, description: 'Lista de rascunhos retornada com sucesso' })
  @ApiQuery({ name: 'status', required: false, description: 'Filtro por status: pending|processing|done|error' })
  @ApiQuery({ name: 'batchId', required: false, description: 'Filtro por ID do lote' })
  @ApiQuery({ name: 'limit', required: false, description: 'Limite de itens', type: Number })
  @ApiQuery({ name: 'offset', required: false, description: 'Offset para paginação', type: Number })
  async findAll(
    @Query('status') status?: 'pending' | 'processing' | 'done' | 'error',
    @Query('batchId') batchId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const params = {
      status,
      batchId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    };
    return await this.draftsService.findAll(params);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter rascunho por ID' })
  @ApiResponse({ status: 200, description: 'Rascunho retornado com sucesso' })
  async findOne(@Param('id') id: string) {
    return await this.draftsService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir rascunho por ID' })
  @ApiResponse({ status: 200, description: 'Rascunho excluído com sucesso' })
  async remove(@Param('id') id: string) {
    const success = await this.draftsService.remove(id);
    return { success };
  }
}
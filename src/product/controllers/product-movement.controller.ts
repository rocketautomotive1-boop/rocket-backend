import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery
} from '@nestjs/swagger';
import { ProductMovementService } from '../services/product-movement.service';
import { ProductService } from '../product.service';
import { CreateProductMovementDto } from '../dto/create-product-movement.dto';
import { UpdateProductMovementDto } from '../dto/update-product-movement.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProductMovement } from '../product-types';

@ApiTags('Product Movement')
@Controller('product-movements')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductMovementController {
  constructor(
    private readonly productMovementService: ProductMovementService,
    private readonly productService: ProductService
  ) { }

  @Get()
  @ApiOperation({ summary: 'Listar todas as movimentações de produtos' })
  @ApiResponse({ status: 200, description: 'Lista de movimentações retornada com sucesso' })
  @ApiQuery({ name: 'productId', required: false, description: 'Filtrar por ID do produto' })
  @ApiQuery({ name: 'type', required: false, description: 'Filtrar por tipo de movimento' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Data de início (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'Data de fim (YYYY-MM-DD)' })
  async findAll(
    @Query('productId') productId?: string,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ): Promise<ProductMovement[]> {
    return this.productMovementService.findAll(productId, type, startDate, endDate);
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Listar movimentações de um produto específico' })
  @ApiResponse({ status: 200, description: 'Movimentações do produto retornadas com sucesso' })
  async findByProduct(@Param('productId') productId: string): Promise<any[]> {
    return this.productMovementService.findByProduct(productId);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Obter estatísticas das movimentações' })
  @ApiResponse({ status: 200, description: 'Estatísticas retornadas com sucesso' })
  @ApiQuery({ name: 'productId', required: false, description: 'Filtrar por ID do produto' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Data de início (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'Data de fim (YYYY-MM-DD)' })
  async getStatistics(
    @Query('productId') productId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.productMovementService.getMovementStatistics(productId, startDate, endDate);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar movimentação por ID' })
  @ApiResponse({ status: 200, description: 'Movimentação encontrada com sucesso' })
  @ApiResponse({ status: 404, description: 'Movimentação não encontrada' })
  async findOne(@Param('id') id: string): Promise<any> {
    return this.productMovementService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Criar nova movimentação de produto' })
  @ApiResponse({ status: 201, description: 'Movimentação criada com sucesso' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  async create(@Body() createMovementDto: CreateProductMovementDto): Promise<any> {
    return this.productMovementService.create(createMovementDto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar movimentação' })
  @ApiResponse({ status: 200, description: 'Movimentação atualizada com sucesso' })
  @ApiResponse({ status: 404, description: 'Movimentação não encontrada' })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  async update(
    @Param('id') id: string,
    @Body() updateMovementDto: UpdateProductMovementDto,
  ): Promise<any> {
    return this.productMovementService.update(id, updateMovementDto);
  }

  @Put(':id/process')
  @ApiOperation({ summary: 'Processar movimentação (marcar como concluída)' })
  @ApiResponse({ status: 200, description: 'Movimentação processada com sucesso' })
  @ApiResponse({ status: 404, description: 'Movimentação não encontrada' })
  @ApiResponse({ status: 400, description: 'Movimentação já foi processada' })
  async processMovement(@Param('id') id: string): Promise<any> {
    return this.productMovementService.processMovement(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Excluir movimentação' })
  @ApiResponse({ status: 200, description: 'Movimentação excluída com sucesso' })
  @ApiResponse({ status: 404, description: 'Movimentação não encontrada' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    await this.productMovementService.remove(id);
    return { message: 'Movimentação excluída com sucesso' };
  }
}


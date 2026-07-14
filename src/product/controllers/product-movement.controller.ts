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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { CreateProductMovementDto } from '../dto/create-product-movement.dto';
import { UpdateProductMovementDto } from '../dto/update-product-movement.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StockService } from '../../stock/stock.service';
import { StockQueryService } from '../../stock/stock-query.service';
import { StockMovementType } from '../../stock/domain/movement-type';

/**
 * Movement API over the StockModule (single write path). The ledger is append-only:
 * "update" appends a compensating adjustment for the diff; "delete" appends a reversal.
 * The HTTP contract is preserved so the inventory UI keeps working.
 */
@ApiTags('Product Movement')
@Controller('product-movements')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductMovementController {
  constructor(
    private readonly stock: StockService,
    private readonly stockQuery: StockQueryService,
  ) {}

  private mapType(legacy?: string): StockMovementType {
    switch ((legacy || 'inbound').toLowerCase()) {
      case 'outbound':
      case 'sale':
        return StockMovementType.OUTBOUND;
      case 'reservation':
        return StockMovementType.RESERVATION;
      case 'release':
        return StockMovementType.RELEASE;
      case 'transfer':
        return StockMovementType.TRANSFER;
      case 'adjustment':
        return StockMovementType.ADJUSTMENT;
      case 'inbound':
      case 'purchase_return':
      default:
        return StockMovementType.INBOUND;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Listar movimentações (por produto)' })
  @ApiResponse({ status: 200, description: 'Lista de movimentações' })
  @ApiQuery({ name: 'productId', required: false })
  async findAll(@Query('productId') productId?: string): Promise<any[]> {
    if (!productId) return [];
    return this.stockQuery.listMovements(productId, 200);
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Listar movimentações de um produto' })
  async findByProduct(@Param('productId') productId: string): Promise<any[]> {
    return this.stockQuery.listMovements(productId, 200);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Estatísticas de movimentações de um produto' })
  @ApiQuery({ name: 'productId', required: false })
  async getStatistics(@Query('productId') productId?: string) {
    if (!productId) return {};
    return this.stockQuery.getMovementStatistics(productId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar movimentação (via StockService)' })
  @ApiResponse({ status: 201, description: 'Movimentação criada' })
  async create(@Body() dto: CreateProductMovementDto): Promise<any> {
    return this.stock.move({
      productId: String(dto.productId),
      type: this.mapType(dto.type),
      quantity: dto.quantity,
      condition: (dto.condition as any) ?? 'new',
      unitCost: dto.costPrice ?? dto.price,
      salePrice: dto.salePrice,
      reference: dto.reference,
      reason: dto.reason,
      toBoxId: dto.boxId ? String(dto.boxId) : undefined,
      origin: dto.origin,
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Corrigir quantidade (append-only: gera ajuste da diferença)' })
  async update(@Param('id') id: string, @Body() dto: UpdateProductMovementDto): Promise<any> {
    if (dto.quantity == null) {
      return { message: 'Nada a corrigir (quantidade não informada).' };
    }
    return this.stock.editMovementViaAdjustment(id, dto.quantity);
  }

  @Put(':id/process')
  @ApiOperation({ summary: 'Processar movimentação (no-op: movimentos já são efetivos)' })
  async processMovement(@Param('id') id: string): Promise<any> {
    return { id, status: 'completed', message: 'Movimentos são efetivos no momento da criação.' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Estornar movimentação (append-only: gera movimento de estorno)' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    await this.stock.reverseMovement(id);
    return { message: 'Movimentação estornada (ajuste de estorno criado).' };
  }
}

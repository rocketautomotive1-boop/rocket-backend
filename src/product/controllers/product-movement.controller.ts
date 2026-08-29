import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Inject,
  UseGuards,
  BadRequestException,
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
import { STOCK_WRITE_PORT, StockWritePort } from '../../stock/ports/stock-write.port';
import { StockMovementType } from '../../stock-shared/movement-type';
import { STORE_AWARE_STOCK_QUERY_PORT, StoreAwareStockQueryPort } from '../../stock/ports/stock-query.port';

/**
 * Movement API over the StockModule (single write path). The ledger is append-only:
 * "update" appends a compensating adjustment for the diff; "delete" appends a reversal.
 * The HTTP contract is preserved so the inventory UI keeps working.
 *
 * Leitura (findAll/findByProduct/getStatistics) é store-aware (Fase 4): lê via
 * STORE_AWARE_STOCK_QUERY_PORT com o storeId do usuário autenticado — sem StoreListing próprio
 * pra loja, retorna vazio, nunca mostra o histórico de outra loja.
 */
@ApiTags('Product Movement')
@Controller('product-movements')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductMovementController {
  constructor(
    @Inject(STOCK_WRITE_PORT) private readonly stock: StockWritePort,
    @Inject(STORE_AWARE_STOCK_QUERY_PORT) private readonly stockQuery: StoreAwareStockQueryPort,
  ) {}

  private requireStoreId(req: any): string {
    const storeId = req?.user?.storeId;
    if (!storeId) {
      throw new BadRequestException('Usuário sem loja configurada — não é possível lançar movimentação de estoque.');
    }
    return storeId;
  }

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
  async findAll(@Query('productId') productId: string | undefined, @Req() req: any): Promise<any[]> {
    if (!productId) return [];
    return this.stockQuery.listStoreStockMovements(productId, this.requireStoreId(req), 200);
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Listar movimentações de um produto' })
  async findByProduct(@Param('productId') productId: string, @Req() req: any): Promise<any[]> {
    return this.stockQuery.listStoreStockMovements(productId, this.requireStoreId(req), 200);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Estatísticas de movimentações de um produto' })
  @ApiQuery({ name: 'productId', required: false })
  async getStatistics(@Query('productId') productId: string | undefined, @Req() req: any) {
    if (!productId) return {};
    return this.stockQuery.getStoreStockMovementStatistics(productId, this.requireStoreId(req));
  }

  @Post()
  @ApiOperation({ summary: 'Criar movimentação (via StockService)' })
  @ApiResponse({ status: 201, description: 'Movimentação criada' })
  async create(@Body() dto: CreateProductMovementDto, @Req() req: any): Promise<any> {
    return this.stock.move({
      productId: String(dto.productId),
      storeId: this.requireStoreId(req),
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
  async update(@Param('id') id: string, @Body() dto: UpdateProductMovementDto, @Req() req: any): Promise<any> {
    if (dto.quantity == null) {
      return { message: 'Nada a corrigir (quantidade não informada).' };
    }
    return this.stock.editMovementViaAdjustment(id, dto.quantity, this.requireStoreId(req));
  }

  @Put(':id/process')
  @ApiOperation({ summary: 'Processar movimentação (no-op: movimentos já são efetivos)' })
  async processMovement(@Param('id') id: string): Promise<any> {
    return { id, status: 'completed', message: 'Movimentos são efetivos no momento da criação.' };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Estornar movimentação (append-only: gera movimento de estorno)' })
  async remove(@Param('id') id: string, @Req() req: any): Promise<{ message: string }> {
    await this.stock.reverseMovement(id, this.requireStoreId(req));
    return { message: 'Movimentação estornada (ajuste de estorno criado).' };
  }
}

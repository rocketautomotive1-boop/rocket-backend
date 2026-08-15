import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { STORE_LISTING_PORT, StoreListingPort } from './ports/store-listing.port';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { MarkUnitsAsDamagedDto } from './dto/mark-units-as-damaged.dto';
import { UpdateDamagedUnitDto } from './dto/update-damaged-unit.dto';
import { AllocateDamagedUnitDto } from './dto/allocate-damaged-unit.dto';

/**
 * Depósitos e unidades avariadas do StoreListingModule. storeId nunca vem do
 * client — sempre resolvido de req.user.storeId (mesmo padrão de
 * StockController/ProductMovementController), para que uma loja nunca
 * consiga ler/escrever dados de outra por engano ou má-fé.
 */
@ApiTags('Store Listing')
@Controller('store-listing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StoreListingController {
  constructor(@Inject(STORE_LISTING_PORT) private readonly storeListing: StoreListingPort) {}

  private requireStoreId(req: any): string {
    const storeId = req?.user?.storeId;
    if (!storeId) {
      throw new BadRequestException('Usuário sem loja configurada — não é possível gerenciar depósitos.');
    }
    return storeId;
  }

  @Post('warehouses')
  @ApiOperation({ summary: 'Cria um depósito para a loja do usuário autenticado' })
  async createWarehouse(@Req() req: any, @Body() body: CreateWarehouseDto) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.createWarehouse(storeId, body.name, body.address);
  }

  @Get('warehouses')
  @ApiOperation({ summary: 'Lista os depósitos da loja do usuário autenticado' })
  async listWarehouses(@Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.listWarehouses(storeId);
  }

  @Post('products/:productId/damaged-units')
  @ApiOperation({ summary: 'Marca K unidades do lote fungível "new" como avariadas' })
  async markUnitsAsDamaged(
    @Param('productId') productId: string,
    @Req() req: any,
    @Body() body: MarkUnitsAsDamagedDto,
  ) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.markUnitsAsDamaged({
      productId,
      storeId,
      sourceCondition: body.sourceCondition,
      quantity: body.quantity,
      targetCondition: body.targetCondition,
      reason: body.reason,
    });
  }

  @Get('products/:productId/damaged-units')
  @ApiOperation({ summary: 'Lista as unidades avariadas do produto na loja do usuário autenticado' })
  async listDamagedUnits(
    @Param('productId') productId: string,
    @Req() req: any,
    @Query('status') status?: string,
  ) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.listDamagedUnits(productId, storeId, status as any);
  }

  @Put('damaged-units/:unitId')
  @ApiOperation({ summary: 'Atualiza fotos, descrição do dano e/ou preço de uma unidade avariada' })
  async updateDamagedUnit(
    @Param('unitId') unitId: string,
    @Req() req: any,
    @Body() body: UpdateDamagedUnitDto,
  ) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.updateDamagedUnit(unitId, storeId, body);
  }

  @Put('damaged-units/:unitId/allocation')
  @ApiOperation({ summary: 'Aloca uma unidade avariada num depósito' })
  async allocateDamagedUnit(
    @Param('unitId') unitId: string,
    @Req() req: any,
    @Body() body: AllocateDamagedUnitDto,
  ) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.allocateDamagedUnit(unitId, storeId, body.warehouseId, body.position);
  }
}

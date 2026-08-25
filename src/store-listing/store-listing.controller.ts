import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { CreateAllocationDto } from './dto/create-allocation.dto';
import { CreateBoxDto } from './dto/create-box.dto';
import { UpdateBoxDto } from './dto/update-box.dto';
import { AddBoxProductDto } from './dto/add-box-product.dto';
import { LinkBoxAllocationDto } from './dto/link-box-allocation.dto';
import { ScanBoxDto } from './dto/scan-box.dto';

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

  @Post('allocations')
  @ApiOperation({ summary: 'Cria uma alocação (localização física) num depósito da loja do usuário autenticado' })
  async createAllocation(@Req() req: any, @Body() body: CreateAllocationDto) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.createAllocation(storeId, body);
  }

  @Get('allocations')
  @ApiOperation({ summary: 'Lista as alocações dos depósitos da loja do usuário autenticado' })
  async listAllocations(@Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.listAllocations(storeId);
  }

  @Post('allocations/scan')
  @ApiOperation({ summary: 'Escaneia QR de allocation: busca por ID/locationPath ou cria (dryRun=true só pré-visualiza)' })
  async scanAllocation(@Req() req: any, @Body() body: { qr: string }, @Query('dryRun') dryRun?: string) {
    const storeId = this.requireStoreId(req);
    const isDryRun = typeof dryRun === 'string' ? dryRun === 'true' : false;
    return this.storeListing.scanAllocation(storeId, body.qr, isDryRun);
  }

  @Get('allocations/:id')
  @ApiOperation({ summary: 'Busca uma alocação pelo ID' })
  async getAllocation(@Param('id') id: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.getAllocation(storeId, id);
  }

  @Get('allocations/:id/products')
  @ApiOperation({ summary: 'Busca os produtos de todos os boxes de uma alocação, agrupados por box' })
  async getAllocationProducts(@Param('id') id: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.getAllocationProducts(storeId, id);
  }

  @Post('allocations/:allocationId/boxes')
  @ApiOperation({ summary: 'Cria um box numa alocação da loja do usuário autenticado' })
  async createBox(
    @Param('allocationId') allocationId: string,
    @Req() req: any,
    @Body() body: CreateBoxDto,
  ) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.createBox(storeId, allocationId, body);
  }

  @Get('boxes')
  @ApiOperation({ summary: 'Lista os boxes da loja do usuário autenticado' })
  async listBoxes(@Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.listBoxes(storeId);
  }

  @Get('boxes/code/:code')
  @ApiOperation({ summary: 'Busca um box pelo código' })
  async getBoxByCode(@Param('code') code: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.getBoxByCode(storeId, code);
  }

  @Get('boxes/code/:code/items')
  @ApiOperation({ summary: 'Busca um box pelo código com os produtos alocados' })
  async getBoxProductsByCode(@Param('code') code: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.getBoxProductsByCode(storeId, code);
  }

  @Post('boxes/scan')
  @ApiOperation({ summary: 'Escaneia QR de box: liga a um box existente na alocação ou cria um novo' })
  async scanBox(@Req() req: any, @Body() body: ScanBoxDto) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.scanBox(storeId, body.qr, body.allocationId);
  }

  @Get('products/:productId/boxes')
  @ApiOperation({ summary: 'Lista os boxes que contêm o produto, na loja do usuário autenticado' })
  async getBoxesByProduct(@Param('productId') productId: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.getBoxesByProduct(storeId, productId);
  }

  @Get('boxes/:id')
  @ApiOperation({ summary: 'Busca um box pelo ID' })
  async getBox(@Param('id') id: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.getBox(storeId, id);
  }

  @Put('boxes/:id')
  @ApiOperation({ summary: 'Atualiza código/descrição de um box' })
  async updateBox(@Param('id') id: string, @Req() req: any, @Body() body: UpdateBoxDto) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.updateBox(storeId, id, body);
  }

  @Delete('boxes/:id')
  @ApiOperation({ summary: 'Remove um box' })
  async removeBox(@Param('id') id: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    await this.storeListing.removeBox(storeId, id);
    return { message: 'Box removido com sucesso' };
  }

  @Get('boxes/:id/items')
  @ApiOperation({ summary: 'Busca os produtos alocados num box' })
  async getBoxProducts(@Param('id') id: string, @Req() req: any) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.getBoxProducts(storeId, id);
  }

  @Post('boxes/:id/products')
  @ApiOperation({ summary: 'Adiciona um produto a um box' })
  async addProductToBox(@Param('id') id: string, @Req() req: any, @Body() body: AddBoxProductDto) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.addProductToBox(storeId, id, body.productId);
  }

  @Delete('boxes/:id/products/:productId')
  @ApiOperation({ summary: 'Remove um produto de um box' })
  async removeProductFromBox(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Req() req: any,
  ) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.removeProductFromBox(storeId, id, productId);
  }

  @Put('boxes/:id/allocation')
  @ApiOperation({ summary: 'Move um box para outra alocação' })
  async linkBoxToAllocation(@Param('id') id: string, @Req() req: any, @Body() body: LinkBoxAllocationDto) {
    const storeId = this.requireStoreId(req);
    return this.storeListing.linkBoxToAllocation(storeId, id, body.allocationId);
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

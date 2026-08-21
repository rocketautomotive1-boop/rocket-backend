import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { BoxService } from '../services/box.service';
import { CreateBoxDto } from '../dto/create-box.dto';
import { UpdateBoxDto } from '../dto/update-box.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('boxes')
export class BoxController {
  constructor(
    private readonly boxService: BoxService,
  ) { }

  @Post()
  create(@Body() createBoxDto: CreateBoxDto) {
    return this.boxService.create(createBoxDto);
  }

  @Get()
  findAll(@Query('warehouseId') warehouseId?: string, @Query('search') search?: string) {
    return this.boxService.findAll(warehouseId, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.boxService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateBoxDto: UpdateBoxDto) {
    return this.boxService.update(id, updateBoxDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.boxService.remove(id);
  }

  @Get(':id/items')
  getBoxItems(@Param('id') id: string) {
    return this.boxService.getBoxItems(id);
  }

  @Get(':id/movements')
  getBoxMovements(@Param('id') id: string) {
    return this.boxService.getBoxMovements(id);
  }

  @Get(':id/allocation')
  getBoxAllocation(@Param('id') id: string) {
    return this.boxService.getBoxAllocation(id);
  }

  @Get('code/:code')
  findByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxService.findByCode(code, warehouseId);
  }

  @Get('code/:code/items')
  getBoxItemsByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxService.getBoxItemsByCode(code, warehouseId);
  }

  @Get('code/:code/movements')
  getBoxMovementsByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxService.getBoxMovementsByCode(code, warehouseId);
  }

  @Get('code/:code/allocation')
  getBoxAllocationByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxService.getBoxAllocationByCode(code, warehouseId);
  }

  @Post('generate')
  createBoxWithCode(@Body() body: { warehouseId: string; description?: string; allocationId?: string }) {
    return this.boxService.createBoxWithCode(body.warehouseId, body.description, body.allocationId);
  }

  @Post('with-allocation')
  createBoxWithAllocation(@Body() body: {
    warehouseId: string;
    // Novo esquema
    floor?: number;
    room?: number;
    row?: string;
    shelf?: number;
    level?: number;
    bin?: number;
    // Esquema legado
    area?: string;
    column?: string;
    aisle?: number;
    rack?: string;
    position?: number;
    // comum
    conditionId: string;
    description?: string;
  }) {
    if (
      typeof body.floor === 'number' &&
      typeof body.room === 'number' &&
      typeof body.shelf === 'number' &&
      typeof body.level === 'number' &&
      typeof body.bin === 'number' &&
      body.row
    ) {
      return this.boxService.createBoxWithAllocationNew(
        body.warehouseId,
        body.floor,
        body.room,
        body.row,
        body.shelf,
        body.level,
        body.bin,
        body.conditionId,
        body.description
      );
    }

    return this.boxService.createBoxWithAllocation(
      body.warehouseId,
      body.area!,
      body.column!,
      body.aisle!,
      body.rack!,
      body.shelf!,
      body.bin!,
      body.position!,
      body.conditionId,
      body.description
    );
  }

  @Post('code/:code/products')
  addProductToBoxByCode(
    @Param('code') code: string,
    @Body() body: { productId: string; conditionId: string; quantity?: number },
    @Query('warehouseId') warehouseId?: string
  ) {
    return this.boxService.addProductToBoxByCode(
      code,
      body.productId,
      body.conditionId,
      body.quantity || 1,
      warehouseId
    );
  }

  @Post(':id/products')
  addProductToBox(
    @Param('id') id: string,
    @Body() body: { productId: string; conditionId: string; quantity?: number }
  ) {
    return this.boxService.addProductToBox(
      id,
      body.productId,
      body.conditionId,
      body.quantity || 1
    );
  }

  // NOVO: endpoint para leitura de QR de box
  @Post('scan')
  scanBox(
    @Body() body: { qr: string; warehouseId: string; allocationId: string; description?: string }
  ) {
    return this.boxService.scanBox(body.qr, body.warehouseId, body.allocationId, body.description);
  }

  // NOVO: vincular box existente a uma allocation por ID
  @Put(':id/allocation')
  linkBoxToAllocation(
    @Param('id') id: string,
    @Body() body: { allocationId: string }
  ) {
    return this.boxService.linkBoxToAllocation(id, body.allocationId);
  }

  // NOVO: vincular box existente a uma allocation por código (opcional warehouse)
  @Put('code/:code/allocation')
  linkBoxToAllocationByCode(
    @Param('code') code: string,
    @Body() body: { allocationId: string },
    @Query('warehouseId') warehouseId?: string
  ) {
    return this.boxService.linkBoxToAllocationByCode(code, body.allocationId, warehouseId);
  }
}
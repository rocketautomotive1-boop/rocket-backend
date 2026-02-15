import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { BoxService } from '../services/box.service';
import { BoxItemService } from '../services/box-item.service';
import { CreateBoxDto } from '../dto/create-box.dto';
import { UpdateBoxDto } from '../dto/update-box.dto';
import { CreateBoxItemDto } from '../dto/create-box-item.dto';
import { AddBoxItemDto } from '../dto/add-box-item.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('boxes')
export class BoxController {
  constructor(
    private readonly boxService: BoxService,
    private readonly boxItemService: BoxItemService,
  ) {}

  @Post()
  create(@Body() createBoxDto: CreateBoxDto) {
    return this.boxService.create(createBoxDto);
  }

  @Get()
  findAll(@Query('warehouseId') warehouseId?: string, @Query('search') search?: string) {
    return this.boxService.findAll(warehouseId ? +warehouseId : undefined, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.boxService.findOne(+id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateBoxDto: UpdateBoxDto) {
    return this.boxService.update(+id, updateBoxDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.boxService.remove(+id);
  }

  @Get(':id/items')
  getBoxItems(@Param('id') id: string) {
    return this.boxService.getBoxItems(+id);
  }

  @Post(':id/items')
  addItemToBox(@Param('id') id: string, @Body() addBoxItemDto: AddBoxItemDto) {
    const createBoxItemDto: CreateBoxItemDto = {
      boxId: +id,
      productId: addBoxItemDto.productId,
      conditionId: addBoxItemDto.conditionId,
      quantity: addBoxItemDto.quantity
    };
    
    return this.boxItemService.create(createBoxItemDto);
  }

  @Post(':id/items/multiple')
  addMultipleItemsToBox(@Param('id') id: string, @Body() items: AddBoxItemDto[]) {
    const createBoxItemsDto: CreateBoxItemDto[] = items.map(item => ({
      boxId: +id,
      productId: item.productId,
      conditionId: item.conditionId,
      quantity: item.quantity
    }));
    
    return this.boxItemService.addMultipleItems(+id, createBoxItemsDto);
  }

  @Get(':id/movements')
  getBoxMovements(@Param('id') id: string) {
    return this.boxService.getBoxMovements(+id);
  }

  @Get(':id/allocation')
  getBoxAllocation(@Param('id') id: string) {
    return this.boxService.getBoxAllocation(+id);
  }

  @Get(':id/summary')
  getBoxSummary(@Param('id') id: string) {
    return this.boxItemService.getBoxItemsSummary(+id);
  }

  @Get('code/:code')
  findByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxService.findByCode(code, warehouseId ? +warehouseId : undefined);
  }

  @Get('code/:code/items')
  getBoxItemsByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxService.getBoxItemsByCode(code, warehouseId ? +warehouseId : undefined);
  }

  @Post('code/:code/items')
  addItemToBoxByCode(@Param('code') code: string, @Body() addBoxItemDto: AddBoxItemDto, @Query('warehouseId') warehouseId?: string) {
    return this.boxItemService.addItemToBoxByCode(code, addBoxItemDto, warehouseId ? +warehouseId : undefined);
  }

  @Post('code/:code/items/multiple')
  addMultipleItemsToBoxByCode(@Param('code') code: string, @Body() items: AddBoxItemDto[], @Query('warehouseId') warehouseId?: string) {
    return this.boxItemService.addMultipleItemsToBoxByCode(code, items, warehouseId ? +warehouseId : undefined);
  }

  @Get('code/:code/movements')
  getBoxMovementsByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxService.getBoxMovementsByCode(code, warehouseId ? +warehouseId : undefined);
  }

  @Get('code/:code/allocation')
  getBoxAllocationByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxService.getBoxAllocationByCode(code, warehouseId ? +warehouseId : undefined);
  }

  @Get('code/:code/summary')
  getBoxSummaryByCode(@Param('code') code: string, @Query('warehouseId') warehouseId?: string) {
    return this.boxItemService.getBoxItemsSummaryByCode(code, warehouseId ? +warehouseId : undefined);
  }

  @Post('generate')
  createBoxWithCode(@Body() body: { warehouseId: number; description?: string; allocationId?: number }) {
    return this.boxService.createBoxWithCode(body.warehouseId, body.description, body.allocationId);
  }

  @Post('with-allocation')
  createBoxWithAllocation(@Body() body: {
    warehouseId: number;
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
    conditionId: number;
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
    @Body() body: { productId: number; conditionId: number; quantity?: number },
    @Query('warehouseId') warehouseId?: string
  ) {
    return this.boxItemService.addItemToBoxByCode(
      code,
      {
        productId: body.productId,
        conditionId: body.conditionId,
        quantity: body.quantity || 1
      },
      warehouseId ? +warehouseId : undefined
    );
  }

  // NOVO: endpoint para leitura de QR de box
  @Post('scan')
  scanBox(
    @Body() body: { qr: string; warehouseId: number; allocationId: number; description?: string }
  ) {
    return this.boxService.scanBox(body.qr, body.warehouseId, body.allocationId, body.description);
  }

  // NOVO: vincular box existente a uma allocation por ID
  @Put(':id/allocation')
  linkBoxToAllocation(
    @Param('id') id: string,
    @Body() body: { allocationId: number }
  ) {
    return this.boxService.linkBoxToAllocation(+id, body.allocationId);
  }

  // NOVO: vincular box existente a uma allocation por código (opcional warehouse)
  @Put('code/:code/allocation')
  linkBoxToAllocationByCode(
    @Param('code') code: string,
    @Body() body: { allocationId: number },
    @Query('warehouseId') warehouseId?: string
  ) {
    return this.boxService.linkBoxToAllocationByCode(code, body.allocationId, warehouseId ? +warehouseId : undefined);
  }
}
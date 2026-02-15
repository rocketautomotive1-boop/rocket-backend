import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { WarehouseService } from '../services/warehouse.service';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { UpdateWarehouseDto } from '../dto/update-warehouse.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('warehouses')
@UseGuards(JwtAuthGuard)
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Post()
  create(@Body() createWarehouseDto: CreateWarehouseDto) {
    return this.warehouseService.create(createWarehouseDto);
  }

  @Get()
  findAll(@Query('search') search?: string) {
    return this.warehouseService.findAll(search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.warehouseService.findOne(+id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateWarehouseDto: UpdateWarehouseDto) {
    return this.warehouseService.update(+id, updateWarehouseDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.warehouseService.remove(+id);
  }

  @Get(':id/boxes')
  getWarehouseBoxes(@Param('id') id: string) {
    return this.warehouseService.getWarehouseBoxes(+id);
  }

  @Get(':id/movements')
  getWarehouseMovements(@Param('id') id: string) {
    return this.warehouseService.getWarehouseMovements(+id);
  }

  @Get(':id/allocations')
  getWarehouseAllocations(@Param('id') id: string) {
    return this.warehouseService.getWarehouseAllocations(+id);
  }
} 
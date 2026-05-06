import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { VehicleCompatibilityService } from '../services/vehicle-compatibility.service';
import { CreateVehicleCompatibilityDto } from '../dto/create-vehicle-compatibility.dto';
import { SearchVehicleCompatibilitiesDto } from '../dto/search-vehicle-compatibilities.dto';
import { UpdateVehicleCompatibilityDto } from '../dto/update-vehicle-compatibility.dto';
import { UpsertVehicleCompatibilityDto } from '../dto/upsert-vehicle-compatibility.dto';

@Controller('vehicle-compatibility')
export class VehicleCompatibilityController {
  constructor(private readonly service: VehicleCompatibilityService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVehicleCompatibilityDto) {
    return this.service.create(dto);
  }

  @Put('upsert')
  @HttpCode(HttpStatus.OK)
  upsert(@Body() dto: UpsertVehicleCompatibilityDto) {
    return this.service.upsertByCanonicalKey(dto);
  }

  @Get()
  search(@Query() dto: SearchVehicleCompatibilitiesDto) {
    return this.service.search(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVehicleCompatibilityDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}

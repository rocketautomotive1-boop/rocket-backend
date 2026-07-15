import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { VehicleCompatibilityGroupService } from '../services/vehicle-compatibility-group.service';
import { CreateVehicleCompatibilityGroupDto } from '../dto/create-vehicle-compatibility-group.dto';
import { UpdateVehicleCompatibilityGroupDto } from '../dto/update-vehicle-compatibility-group.dto';

@Controller('vehicle-compatibility-groups')
export class VehicleCompatibilityGroupController {
  constructor(private readonly service: VehicleCompatibilityGroupService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVehicleCompatibilityGroupDto) {
    return this.service.create(dto);
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.service.findByIdPopulated(id);
  }

  @Get(':id/vehicles')
  getVehicleIds(@Param('id') id: string) {
    return this.service.getVehicleIds(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateVehicleCompatibilityGroupDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}

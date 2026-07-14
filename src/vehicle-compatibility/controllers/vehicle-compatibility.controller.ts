import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { VehicleCompatibilityService } from '../services/vehicle-compatibility.service';
import { PlateLookupService } from '../services/plate-lookup.service';
import { CreateVehicleCompatibilityDto } from '../dto/create-vehicle-compatibility.dto';
import { SearchVehicleCompatibilitiesDto } from '../dto/search-vehicle-compatibilities.dto';
import { UpdateVehicleCompatibilityDto } from '../dto/update-vehicle-compatibility.dto';
import { UpsertVehicleCompatibilityDto } from '../dto/upsert-vehicle-compatibility.dto';
import { ResolveVehicleDto } from '../dto/resolve-vehicle.dto';
import { ResolveVehicleByPlateDto } from '../dto/resolve-vehicle-by-plate.dto';
import { VehicleCompatibilityFacetsDto } from '../dto/vehicle-compatibility-facets.dto';

@Controller('vehicle-compatibility')
export class VehicleCompatibilityController {
  constructor(
    private readonly service: VehicleCompatibilityService,
    private readonly plateLookupService: PlateLookupService,
  ) {}

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

  @Get('facets')
  facets(@Query() dto: VehicleCompatibilityFacetsDto) {
    return this.service.getFacets(dto);
  }

  @Get('resolve')
  resolve(@Query() dto: ResolveVehicleDto) {
    return this.service.resolve(dto);
  }

  @Get('resolve-by-plate')
  resolveByPlate(@Query() dto: ResolveVehicleByPlateDto) {
    return this.plateLookupService.resolveByPlate(dto.placa);
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

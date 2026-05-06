import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { VehicleDiscoveryService } from '../services/vehicle-discovery.service';
import { CreateVehicleDiscoveryDto } from '../dto/create-vehicle-discovery.dto';
import { SearchVehicleDiscoveriesDto } from '../dto/search-vehicle-discoveries.dto';
import { ApproveVehicleDiscoveryDto } from '../dto/approve-vehicle-discovery.dto';
import { RejectVehicleDiscoveryDto } from '../dto/reject-vehicle-discovery.dto';
import { VehicleMetricsService } from '../../vehicle-shared/metrics/vehicle-metrics.service';

@Controller('vehicle-discovery')
export class VehicleDiscoveryController {
  constructor(
    private readonly service: VehicleDiscoveryService,
    private readonly metrics: VehicleMetricsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateVehicleDiscoveryDto) {
    return this.service.create(dto);
  }

  @Get()
  search(@Query() dto: SearchVehicleDiscoveriesDto) {
    return this.service.search(dto);
  }

  @Get('metrics/snapshot')
  getMetricsSnapshot() {
    return this.metrics.snapshot();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveVehicleDiscoveryDto) {
    return this.service.approve(id, dto);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectVehicleDiscoveryDto) {
    return this.service.reject(id, dto);
  }

  @Post(':id/requeue')
  @HttpCode(HttpStatus.OK)
  requeue(@Param('id') id: string) {
    return this.service.requeueAfterError(id);
  }
}

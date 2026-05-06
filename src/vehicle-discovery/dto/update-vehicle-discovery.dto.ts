import { PartialType } from '@nestjs/mapped-types';
import { CreateVehicleDiscoveryDto } from './create-vehicle-discovery.dto';

export class UpdateVehicleDiscoveryDto extends PartialType(CreateVehicleDiscoveryDto) {}

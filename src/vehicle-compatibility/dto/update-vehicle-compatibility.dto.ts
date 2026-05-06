import { PartialType } from '@nestjs/mapped-types';
import { CreateVehicleCompatibilityDto } from './create-vehicle-compatibility.dto';

export class UpdateVehicleCompatibilityDto extends PartialType(CreateVehicleCompatibilityDto) {}

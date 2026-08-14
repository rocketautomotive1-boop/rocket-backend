import { PartialType } from '@nestjs/mapped-types';
import { CreateVehicleCompatibilityGroupDto } from './create-vehicle-compatibility-group.dto';

export class UpdateVehicleCompatibilityGroupDto extends PartialType(CreateVehicleCompatibilityGroupDto) {}

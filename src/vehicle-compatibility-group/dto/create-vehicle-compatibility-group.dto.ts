import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class CreateVehicleCompatibilityGroupDto {
  @IsString() name: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) vehicleIds: string[];
}

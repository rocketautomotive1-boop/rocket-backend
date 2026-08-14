import { IsString } from 'class-validator';

export class AddGarageVehicleDto {
  @IsString() vehicleId: string;
  @IsString() label: string;
}

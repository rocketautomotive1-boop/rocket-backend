import { IsString } from 'class-validator';

export class ResolveVehicleByPlateDto {
  @IsString() placa: string;
}

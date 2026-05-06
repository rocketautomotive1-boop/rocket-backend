import { IsOptional, IsString } from 'class-validator';

export class RejectVehicleDiscoveryDto {
  @IsOptional() @IsString() reviewedBy?: string;
  @IsOptional() @IsString() reviewReason?: string;
}

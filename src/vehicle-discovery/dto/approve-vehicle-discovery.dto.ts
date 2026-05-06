import { IsOptional, IsString } from 'class-validator';

export class ApproveVehicleDiscoveryDto {
  @IsOptional() @IsString() reviewedBy?: string;
  @IsOptional() @IsString() reviewReason?: string;
}

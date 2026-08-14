import { IsString, IsOptional, IsNumber, IsBoolean, IsArray } from 'class-validator';

export class CreateCompatibilityDto {
  @IsOptional()
  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  vehicleId: string;

  @IsOptional()
  @IsString()
  mlVehicleId?: string;

  @IsOptional()
  @IsString()
  vehicleName?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBoolean()
  syncedWithMarketplace?: boolean;
}

export class CreateMultipleCompatibilitiesDto {
  @IsOptional()
  @IsOptional()
  @IsString()
  productId?: string;

  @IsArray()
  @IsString({ each: true })
  vehicleIds: string[];

  @IsOptional()
  @IsArray()
  vehicleDetails?: Array<{
    id: string;
    mlVehicleId?: string;
    name?: string;
  }>;
}
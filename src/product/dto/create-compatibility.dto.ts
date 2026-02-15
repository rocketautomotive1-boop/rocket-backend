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
  vehicleName?: string;

  @IsOptional()
  @IsString()
  vehicleBrand?: string;

  @IsOptional()
  @IsString()
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  vehicleYear?: string;

  @IsOptional()
  @IsString()
  vehicleVersion?: string;

  @IsOptional()
  @IsString()
  vehicleEngine?: string;

  @IsOptional()
  @IsString()
  vehicleFuelType?: string;

  @IsOptional()
  @IsString()
  vehicleTransmission?: string;

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
    name?: string;
    brand?: string;
    model?: string;
    year?: string;
    version?: string;
    engine?: string;
    fuelType?: string;
    transmission?: string;
  }>;
}
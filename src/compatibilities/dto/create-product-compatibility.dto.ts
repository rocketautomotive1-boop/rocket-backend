import { IsString, IsOptional, IsBoolean, IsInt } from 'class-validator';

export class CreateProductCompatibilityDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsInt()
  productTitleId?: number;

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
  @IsBoolean()
  syncedWithMarketplace?: boolean;
}
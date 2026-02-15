import { IsString, IsInt, IsOptional, IsBoolean } from 'class-validator';

export class CreateProductCompatibilityDto {
  @IsOptional()
  @IsInt()
  productId?: number;

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
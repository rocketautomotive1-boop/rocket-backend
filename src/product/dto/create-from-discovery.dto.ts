import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateFromDiscoveryDto {
  @IsString()
  @IsNotEmpty()
  partNumber: string;

  @IsString()
  @IsNotEmpty()
  brandId: string;

  @IsString()
  @IsOptional()
  discoveryId?: string;

  @IsString()
  @IsOptional()
  barcode?: string;
}

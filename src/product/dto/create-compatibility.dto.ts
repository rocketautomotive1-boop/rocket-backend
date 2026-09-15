import { IsString, IsOptional, IsNumber, IsBoolean, IsArray, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

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

  /**
   * Subconjunto de vehicle.years em que esta compatibilidade específica vale —
   * omitir significa "todos os anos do veículo". Ver comentário completo em
   * ProductCompatibilityModel.yearsOverride (schema) para o caso de uso real
   * e a limitação de não valer para o envio ao Mercado Livre.
   */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  yearsOverride?: number[];
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
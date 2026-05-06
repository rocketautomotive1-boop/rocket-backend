import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { VehicleBodyType, VehicleMarket } from '../../vehicle-shared/types/vehicle.types';

export class SearchVehicleCompatibilitiesDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsEnum(VehicleMarket) market?: VehicleMarket;
  @IsOptional() @IsEnum(VehicleBodyType) bodyType?: VehicleBodyType;
  @IsOptional() @Type(() => Number) @IsInt() year?: number;
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() version?: string;
  @IsOptional() @IsString() engineCode?: string;
  @IsOptional() @IsString() engineFamily?: string;
  @IsOptional() @IsString() transmission?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

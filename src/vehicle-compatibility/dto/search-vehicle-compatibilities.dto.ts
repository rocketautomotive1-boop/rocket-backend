import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { VehicleBodyType, VehicleMarket } from '../../vehicle-shared/types/vehicle.types';

const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value === 'true' : value;

export class SearchVehicleCompatibilitiesDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Transform(toBoolean) @IsBoolean() active?: boolean;
  @IsOptional() @IsEnum(VehicleMarket) market?: VehicleMarket;
  @IsOptional() @IsEnum(VehicleBodyType) bodyType?: VehicleBodyType;
  @IsOptional() @Type(() => Number) @IsInt() year?: number;
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() version?: string;
  @IsOptional() @IsString() transmission?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

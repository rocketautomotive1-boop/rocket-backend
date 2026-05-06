import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { VehicleBodyType, VehicleMarket, VehicleSourceType } from '../../vehicle-shared/types/vehicle.types';

class EngineDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() displacement?: string;
  @IsOptional() @IsString() family?: string;
  @IsOptional() @IsString() aspiration?: string;
  @IsOptional() @IsString() fuelType?: string;
  @IsOptional() @IsString() valvetrain?: string;
  @IsOptional() @IsNumber() powerCvGasoline?: number;
  @IsOptional() @IsNumber() powerCvEthanol?: number;
  @IsOptional() @IsNumber() torqueNm?: number;
}

class ProductionYearsDto {
  @Type(() => Number) @IsInt() from: number;
  @Type(() => Number) @IsInt() to: number;
}

class FipeDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsNumber() value?: number;
}

export class CreateVehicleCompatibilityDto {
  @IsString() make: string;
  @IsString() model: string;
  @IsString() version: string;
  @IsOptional() @IsString() versionDisplay?: string;
  @IsOptional() @IsEnum(VehicleMarket) market?: VehicleMarket;

  @IsOptional() @ValidateNested() @Type(() => EngineDto) engine?: EngineDto;
  @IsOptional() @IsArray() @IsString({ each: true }) transmission?: string[];
  @IsOptional() @ValidateNested() @Type(() => ProductionYearsDto) productionYears?: ProductionYearsDto;
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) years?: number[];
  @IsOptional() @IsObject() fuel?: Record<string, any>;

  @IsOptional() @IsString() platform?: string;
  @IsOptional() @IsString() generation?: string;
  @IsOptional() @IsString() facelift?: string;
  @IsOptional() @IsEnum(VehicleBodyType) bodyType?: VehicleBodyType;
  @IsOptional() @IsString() segment?: string;

  @IsOptional() @ValidateNested() @Type(() => FipeDto) fipe?: FipeDto;
  @IsOptional() @IsObject() chassis?: Record<string, any>;
  @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];

  @IsOptional() @IsEnum(VehicleSourceType) sourceType?: VehicleSourceType;
  @IsOptional() @IsNumber() confidence?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

import { Type } from 'class-transformer';
import {
  IsArray,
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
import { VehicleDiscoverySource } from '../../vehicle-shared/types/vehicle.types';

class CreateDiscoveryInputDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() version?: string;
  @IsOptional() @IsString() engine?: string;
  @IsOptional() @IsArray() @IsNumber({}, { each: true }) @Min(1900, { each: true }) @Max(2100, { each: true }) years?: number[];
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() sourceItemId?: string;
  @IsOptional() @IsString() sourceUrl?: string;
  @IsOptional() @IsString() marketplace?: string;
  @IsOptional() @IsObject() rawData?: Record<string, any>;
}

export class CreateVehicleDiscoveryDto {
  @ValidateNested()
  @Type(() => CreateDiscoveryInputDto)
  input: CreateDiscoveryInputDto;

  @IsOptional()
  @IsEnum(VehicleDiscoverySource)
  source?: VehicleDiscoverySource;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  priority?: number;
}

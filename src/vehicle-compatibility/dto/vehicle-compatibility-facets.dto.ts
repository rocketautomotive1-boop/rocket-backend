import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { VehicleBodyType } from '../../vehicle-shared/types/vehicle.types';

const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value === 'true' : value;

export class VehicleCompatibilityFacetsDto {
  @IsOptional() @Transform(toBoolean) @IsBoolean() active?: boolean;
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @Type(() => Number) @IsInt() year?: number;
  @IsOptional() @IsEnum(VehicleBodyType) bodyType?: VehicleBodyType;
  @IsOptional() @IsString() transmission?: string;
}

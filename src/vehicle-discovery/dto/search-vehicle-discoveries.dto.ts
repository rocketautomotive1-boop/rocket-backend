import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { VehicleDiscoveryStatus, VehicleReviewStatus } from '../../vehicle-shared/types/vehicle.types';

export class SearchVehicleDiscoveriesDto {
  @IsOptional() @IsArray() @IsEnum(VehicleDiscoveryStatus, { each: true }) status?: VehicleDiscoveryStatus[];
  @IsOptional() @IsEnum(VehicleReviewStatus) reviewStatus?: VehicleReviewStatus;
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() version?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

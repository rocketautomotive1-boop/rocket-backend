import { IsString, IsArray, IsOptional, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class AttributeFilter {
  @IsString()
  id: string;

  @IsArray()
  @IsString({ each: true })
  value_ids: string[];
}

export class SearchCompatibilitiesDto {
  @IsString()
  domain_id: string;

  @IsString()
  site_id: string;

  @IsOptional()
  @IsString()
  item_id?: string;

  @IsOptional()
  @IsString()
  secondary_product_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeFilter)
  known_attributes: AttributeFilter[];

  @IsOptional()
  sort?: {
    attribute_id: string;
    order: 'asc' | 'desc';
  };

  @IsOptional()
  @IsString()
  filter?: string;

  // Campos para busca no banco de dados
  @IsOptional()
  @IsNumber()
  productId?: number;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  vehicleBrand?: string;

  @IsOptional()
  @IsString()
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  vehicleYear?: string;
}
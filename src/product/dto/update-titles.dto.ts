import { IsNumber, IsArray, ValidateNested, IsString, IsOptional, Allow } from 'class-validator';
import { Type } from 'class-transformer';

export class TitleDto {
  @IsOptional()
  @Allow()
  id?: number | string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @Allow()
  marketplaceId?: number | string; // Adicionar marketplaceId
}

export class UpdateTitlesDto {
  @Allow()
  productId: number | string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TitleDto)
  titles: TitleDto[];
}
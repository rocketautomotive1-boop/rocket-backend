import { IsString, IsOptional, IsNumber, IsEnum, Allow } from 'class-validator';

export class CreateProductTitleDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: string;

  @IsOptional()
  @Allow()
  marketplaceId?: number | string;
}

export class UpdateProductTitleDto extends CreateProductTitleDto { }

export class CreateProductTitlesBatchDto {
  @Allow()
  productId: number | string;

  titles: CreateProductTitleDto[];
}
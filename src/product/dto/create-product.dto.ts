import { IsString, IsNumber, IsNotEmpty, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ description: 'Número da peça do produto' })
  @IsString()
  @IsNotEmpty()
  partNumber: string;

  @ApiProperty({ description: 'ID da marca do produto' })
  @IsString()
  @IsNotEmpty()
  brandId: string;

  @ApiProperty({ description: 'Código de barras do produto', required: false })
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiProperty({ description: 'Flag de produto genuíno (0/1)', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  isGenuine?: number;
}
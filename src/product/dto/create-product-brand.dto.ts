import { IsString, IsOptional, IsBoolean, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductBrandDto {
  @ApiProperty({ description: 'Nome da marca', example: 'Samsung' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Descrição da marca', required: false, example: 'Fabricante sul-coreana de eletrônicos' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ description: 'URL do logo da marca', required: false, example: 'https://example.com/samsung-logo.png' })
  @IsUrl()
  @IsOptional()
  @MaxLength(255)
  logoUrl?: string;

  @ApiProperty({ description: 'Status de ativação da marca', required: false, default: true, example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ description: 'Indica se a marca é genuína', required: false, default: false, example: false })
  @IsBoolean()
  @IsOptional()
  isGenuine?: boolean;

  @ApiProperty({ description: 'Nome curto/abreviado', required: false, example: 'FCA' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  shortName?: string;

  @ApiProperty({ description: 'Nome completo/Razão Social', required: false, example: 'FCA Fiat Chrysler Automóveis Brasil' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  fullName?: string;

  @ApiProperty({ description: 'Nome mapeado para Amazon', required: false, example: 'Fiat' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  amazonName?: string;
}
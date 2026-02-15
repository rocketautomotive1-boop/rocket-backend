import { IsString, IsOptional, IsBoolean, IsNumber, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductNCMDto {
  @ApiProperty({ description: 'Código NCM', example: '8517.12.31' })
  @IsString()
  @MaxLength(10)
  code: string;

  @ApiProperty({ description: 'Descrição do NCM', example: 'Telefones celulares' })
  @IsString()
  @MaxLength(255)
  description: string;

  @ApiProperty({ description: 'Taxa de imposto', required: false, default: 0, example: 17.5 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  taxRate?: number;

  @ApiProperty({ description: 'Status de ativação do NCM', required: false, default: true, example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
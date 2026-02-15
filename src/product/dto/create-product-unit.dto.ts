import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductUnitDto {
  @ApiProperty({ description: 'Código da unidade', example: 'UN' })
  @IsString()
  @MaxLength(10)
  code: string;

  @ApiProperty({ description: 'Nome da unidade', example: 'Unidade' })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiProperty({ description: 'Descrição da unidade', required: false, example: 'Unidade individual do produto' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ description: 'Status de ativação da unidade', required: false, default: true, example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
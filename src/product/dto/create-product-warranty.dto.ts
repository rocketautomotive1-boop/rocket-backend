import { IsString, IsOptional, IsBoolean, IsInt, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductWarrantyDto {
  @ApiProperty({ description: 'Nome da garantia', example: 'Garantia de Fábrica' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Descrição da garantia', required: false, example: 'Garantia oficial do fabricante' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ description: 'Duração da garantia em meses', example: 12 })
  @IsInt()
  @Min(1)
  durationMonths: number;

  @ApiProperty({ description: 'Status de ativação da garantia', required: false, default: true, example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
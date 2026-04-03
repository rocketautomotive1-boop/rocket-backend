import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class CreateBoxDto {
  @ApiProperty({ description: 'ID do warehouse onde a caixa será armazenada' })
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @ApiPropertyOptional({ description: 'ID da alocação onde a caixa será posicionada' })
  @IsString()
  @IsOptional()
  allocationId?: string;

  @ApiPropertyOptional({ description: 'Código único da caixa (gerado automaticamente se não fornecido)' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Descrição da caixa' })
  @IsString()
  @IsOptional()
  description?: string;
} 
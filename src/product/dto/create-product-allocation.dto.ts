import { IsString, IsBoolean, IsOptional, IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductAllocationDto {
  @ApiProperty({ description: 'ID do warehouse (MongoDB ObjectId)' })
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ description: 'Caminho materializado da localização (ex: floor:1/room:2/row:A)' })
  @IsString()
  @IsNotEmpty()
  locationPath: string;

  @ApiPropertyOptional({ description: 'Metadados extras da estrutura de alocação', default: {} })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Se a alocação está disponível', default: true })
  @IsBoolean()
  @IsOptional()
  available?: boolean;

  @ApiPropertyOptional({ description: 'Se a alocação está ativa', default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
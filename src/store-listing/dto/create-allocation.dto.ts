import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAllocationDto {
  @ApiProperty({ description: 'ID do depósito (StoreListingWarehouseModel)' })
  @IsNotEmpty()
  @IsString()
  warehouseId: string;

  @ApiProperty({ description: 'Caminho materializado da localização (ex: F1/R2/ROW3/S1/L1)' })
  @IsNotEmpty()
  @IsString()
  locationPath: string;

  @ApiPropertyOptional({ description: 'Metadados extras da estrutura de alocação', default: {} })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Se a alocação está disponível', default: true })
  @IsOptional()
  @IsBoolean()
  available?: boolean;
}

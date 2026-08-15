import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AllocateDamagedUnitDto {
  @ApiProperty({ description: 'ID do depósito' })
  @IsNotEmpty()
  @IsString()
  warehouseId: string;

  @ApiPropertyOptional({ description: 'Posição física dentro do depósito (prateleira, etc.)' })
  @IsOptional()
  @IsString()
  position?: string;
}

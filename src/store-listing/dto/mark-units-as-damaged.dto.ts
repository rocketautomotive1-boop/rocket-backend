import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MarkUnitsAsDamagedDto {
  @ApiProperty({ description: 'Condição de origem — sempre new (única condição fungível)', enum: ['new'] })
  @IsIn(['new'])
  sourceCondition: 'new';

  @ApiProperty({ description: 'Quantidade de unidades a marcar' })
  @IsInt()
  @IsPositive()
  quantity: number;

  @ApiProperty({ description: 'Condição de destino da unidade avariada', enum: ['damaged', 'used', 'refurbished'] })
  @IsIn(['damaged', 'used', 'refurbished'])
  targetCondition: 'damaged' | 'used' | 'refurbished';

  @ApiPropertyOptional({ description: 'Motivo (ex: dano de transporte, devolução)' })
  @IsOptional()
  @IsString()
  reason?: string;
}

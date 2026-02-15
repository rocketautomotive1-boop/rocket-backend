import { IsString, IsNumber, IsBoolean, IsOptional, Min, MaxLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateProductAllocationDto {
  @ApiPropertyOptional({ description: 'ID do box' })
  @IsNumber()
  @IsOptional()
  boxId?: number

  @ApiPropertyOptional({ description: 'ID do warehouse' })
  @IsNumber()
  @IsOptional()
  warehouseId?: number

  @ApiPropertyOptional({ description: 'ID da condição' })
  @IsNumber()
  @IsOptional()
  conditionId?: number

  // Novos campos estruturais (agora obrigatórios no novo fluxo)
  @ApiProperty({ description: 'Floor number (andar)', default: 1 })
  @IsNumber()
  @Min(1)
  floor: number

  @ApiProperty({ description: 'Room number (sala)', default: 1 })
  @IsNumber()
  @Min(1)
  room: number

  @ApiPropertyOptional({ description: 'Row identifier (fileira/corredor)' })
  @IsOptional()
  @IsString()
  row?: string

  @ApiProperty({ description: 'Shelf number (prateleira)', default: 1 })
  @IsNumber()
  @Min(1)
  shelf: number

  @ApiProperty({ description: 'Shelf level (nível)', default: 1 })
  @IsNumber()
  @Min(1)
  level: number

  @ApiPropertyOptional({ description: 'Computed location code ALLOC-{floor}-{room}-{row}-{level}-{bin}' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  locationCode?: string

  // Campos legados (mantidos para compatibilidade, agora opcionais)
  @ApiPropertyOptional({ description: 'Área da alocação', maxLength: 20 })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  area?: string

  @ApiPropertyOptional({ description: 'Coluna da alocação', maxLength: 10 })
  @IsString()
  @IsOptional()
  @MaxLength(10)
  column?: string

  @ApiPropertyOptional({ description: 'Corredor da alocação' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  aisle?: number

  @ApiPropertyOptional({ description: 'Prateleira da alocação (antigo rack)', maxLength: 1 })
  @IsString()
  @IsOptional()
  @MaxLength(1)
  rack?: string

  // shelf agora faz parte da nova estrutura obrigatória (acima)

  @ApiPropertyOptional({ description: 'Posição da alocação' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  position?: number

  // Bin agora opcional (default 0 será aplicado no serviço/entidade)
  @ApiPropertyOptional({ description: 'Caixa/BIN da alocação' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bin?: number

  @ApiPropertyOptional({ description: 'Código único da alocação (gerado automaticamente se não fornecido)' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  code?: string

  @ApiPropertyOptional({ description: 'Se a alocação está disponível', default: true })
  @IsBoolean()
  @IsOptional()
  available?: boolean

  @ApiPropertyOptional({ description: 'Se a alocação está ativa', default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean
}
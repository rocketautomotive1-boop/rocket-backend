import { IsNotEmpty, IsOptional, IsNumber, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductMovementDto {
  @ApiProperty({ description: 'ID do produto' })
  @ApiProperty({ description: 'ID do produto ou SKU' })
  @IsNotEmpty()
  productId: number | string;

  @ApiPropertyOptional({ description: 'ID da alocação de origem' })
  @IsOptional()
  fromAllocationId?: number | string;

  @ApiPropertyOptional({ description: 'ID da alocação de destino' })
  @IsOptional()
  toAllocationId?: number | string;

  @ApiPropertyOptional({
    description: 'Condição do lote (estoque): new | used | refurbished',
    enum: ['new', 'used', 'refurbished'],
    default: 'new',
  })
  @IsOptional()
  @IsEnum(['new', 'used', 'refurbished'])
  condition?: 'new' | 'used' | 'refurbished';

  /** @deprecated Preferir `condition`. Aceito para clientes legados. */
  @ApiPropertyOptional({ description: 'Legado: 1=novo, 2=usado, 3=recondicionado' })
  @IsOptional()
  @IsNumber()
  conditionId?: number;

  // Removido: warehouseId

  @ApiPropertyOptional({ description: 'ID da caixa' })
  @IsOptional()
  boxId?: number | string;

  @ApiProperty({
    description: 'Tipo de movimento',
    enum: ['inbound', 'outbound', 'transfer', 'adjustment', 'reservation']
  })
  @IsNotEmpty()
  @IsEnum(['inbound', 'outbound', 'transfer', 'adjustment', 'reservation'])
  type: 'inbound' | 'outbound' | 'transfer' | 'adjustment' | 'reservation';

  @ApiProperty({ description: 'Quantidade movimentada' })
  @IsNotEmpty()
  @IsNumber()
  quantity: number;

  @ApiPropertyOptional({ description: 'Preço unitário do produto' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: 'Quantidade anterior' })
  @IsOptional()
  @IsNumber()
  previousQuantity?: number;

  @ApiPropertyOptional({ description: 'Nova quantidade' })
  @IsOptional()
  @IsNumber()
  newQuantity?: number;

  @ApiPropertyOptional({ description: 'Motivo da movimentação' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Referência externa (nota fiscal, pedido, etc.)' })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({ description: 'Observações adicionais' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Observações sobre a situação do item (danificado, defeituoso, etc.)' })
  @IsOptional()
  @IsString()
  observation?: string;

  @ApiPropertyOptional({
    description: 'Situação do item',
    enum: ['normal', 'damaged', 'defective', 'unpackaged', 'incomplete', 'other'],
    default: 'normal'
  })
  @IsOptional()
  @IsEnum(['normal', 'damaged', 'defective', 'unpackaged', 'incomplete', 'other'])
  situation?: 'normal' | 'damaged' | 'defective' | 'unpackaged' | 'incomplete' | 'other';

  @ApiPropertyOptional({
    description: 'Status do movimento',
    default: 'pending'
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Data de processamento' })
  @IsOptional()
  @IsDateString()
  processedAt?: Date;

  @ApiPropertyOptional({ description: 'ID do Pedido (interno)' })
  @IsOptional()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Origem do movimento' })
  @IsOptional()
  origin?: {
    type: string;
    location: string;
  };

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: {
    operator?: string;
    externalReference?: string;
    [key: string]: any;
  };
}


import { IsString, IsNotEmpty, IsEnum, IsNumber, IsOptional, MaxLength } from 'class-validator';

export class CreateMovementDto {
  @IsNumber()
  @IsOptional()
  boxId?: number;

  @IsNumber()
  @IsNotEmpty()
  warehouseId: number;

  @IsEnum(['inbound', 'outbound'])
  @IsNotEmpty()
  type: 'inbound' | 'outbound';

  @IsString()
  @IsOptional()
  @MaxLength(100)
  reason?: string;
} 
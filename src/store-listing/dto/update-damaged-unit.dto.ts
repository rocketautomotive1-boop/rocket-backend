import { IsArray, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDamagedUnitDto {
  @ApiPropertyOptional({ description: 'URLs das fotos da unidade', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];

  @ApiPropertyOptional({ description: 'Descrição do dano' })
  @IsOptional()
  @IsString()
  damageNotes?: string;

  @ApiPropertyOptional({ description: 'Preço próprio desta unidade' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;
}

import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBoxDto {
  @ApiPropertyOptional({ description: 'Código único do box (gerado automaticamente se não fornecido)' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'Descrição do box' })
  @IsOptional()
  @IsString()
  description?: string;
}

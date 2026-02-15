import { IsOptional, IsNumber, IsString, IsObject } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCategoryMappingDto {
  @ApiPropertyOptional({ example: '123', description: 'ID da categoria do marketplace' })
  @IsString()
  @IsOptional()
  marketplaceCategoryId?: string;

  @ApiPropertyOptional({ example: 'MLB12345', description: 'ID externo da categoria no marketplace' })
  @IsString()
  @IsOptional()
  externalId?: string;

  @ApiPropertyOptional({ example: 'Eletrônicos > Celulares', description: 'Nome/Caminho da categoria no marketplace' })
  @IsString()
  @IsOptional()
  externalName?: string;

  @ApiPropertyOptional({ example: 'Categoria Interna', description: 'Nome da categoria interna' })
  @IsString()
  @IsOptional()
  internalCategoryName?: string;

  @ApiPropertyOptional({ example: 'Categoria Pai > Categoria Interna', description: 'Caminho completo da categoria interna' })
  @IsString()
  @IsOptional()
  internalCategoryPath?: string;

  @ApiPropertyOptional({
    example: {
      color: 'cor',
      size: 'tamanho'
    },
    description: 'Mapeamento de atributos entre categoria interna e marketplace'
  })
  @IsObject()
  @IsOptional()
  attributeMappings?: Record<string, any>;
}

import { IsNotEmpty, IsNumber, IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryMappingDto {
  @ApiPropertyOptional({ example: '123', description: 'ID da categoria do marketplace (Opcional - Legado)' })
  @IsString()
  @IsOptional()
  marketplaceCategoryId?: string;

  @ApiProperty({ example: 'MLB12345', description: 'ID externo da categoria no marketplace' })
  @IsString()
  @IsNotEmpty()
  externalId: string;

  @ApiPropertyOptional({ example: 'Eletrônicos > Celulares', description: 'Nome/Caminho da categoria no marketplace' })
  @IsString()
  @IsOptional()
  externalName?: string;

  @ApiProperty({ example: '456', description: 'ID da categoria interna' })
  @IsString()
  @IsNotEmpty()
  internalCategoryId: string;

  @ApiProperty({ example: 'Categoria Interna', description: 'Nome da categoria interna' })
  @IsString()
  @IsNotEmpty()
  internalCategoryName: string;

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

import { IsString, IsOptional, IsBoolean, IsNumber, MaxLength, Min, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ValidateMongoId } from '../../common/decorators/validate-mongo-id.decorator';

export class CreateProductCategoryDto {
  @ApiProperty({ description: 'Nome da categoria', example: 'Eletrônicos' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Descrição da categoria', required: false, example: 'Produtos eletrônicos em geral' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ description: 'ID da categoria pai', required: false, example: '60d5ecb8b5c9e2363c234567' })
  @IsString()
  @IsOptional()
  parentId?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiProperty({ description: 'Ocultar categoria da busca/árvore pública', required: false, default: false })
  @IsBoolean()
  @IsOptional()
  hidden?: boolean;

  @ApiProperty({ description: 'URL da imagem da categoria', required: false, example: 'https://example.com/image.png' })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiProperty({ description: 'Relevância da categoria na busca (0-100)', required: false, example: 10, default: 0 })
  @IsNumber()
  @IsOptional()
  relevance?: number;

  @ApiProperty({ description: 'Sinônimos da categoria', required: false, example: ['Protetor de porca', 'Tampa de porca'] })
  @IsArray()
  @IsOptional()
  synonyms?: string[];

  @ApiProperty({ description: 'Exemplos de produtos desta categoria', required: false, example: ['Capa cromada', 'Tampa antifurto'] })
  @IsArray()
  @IsOptional()
  examples?: string[];

  @ApiProperty({ description: 'Guia de uso da categoria', required: false, example: 'Use para capas e protetores de porcas de roda' })
  @IsString()
  @IsOptional()
  usageGuide?: string;

  @ApiProperty({ description: 'Árvore hierárquica sugerida (cria automaticamente a estrutura)', required: false, example: ['Peças', 'Rodas e Pneus', 'Acessórios'] })
  @IsArray()
  @IsOptional()
  suggestedTree?: string[];

  @ApiProperty({ description: 'Ordem de exibição', required: false, example: 1 })
  @IsNumber()
  @IsOptional()
  order?: number;
}
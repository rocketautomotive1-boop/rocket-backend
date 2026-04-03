// dto/product-filter.dto.ts
import { IsOptional, IsString, IsNumber, IsBoolean, IsArray, IsEnum, ValidateNested, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Enum para status
export enum ProductStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DRAFT = 'draft'
}

export enum InventoryStatus {
  AVAILABLE = 'available',
  OUT_OF_STOCK = 'out_of_stock',
  RESERVED = 'reserved'
}

// DTO para filtros de range numérico
export class NumericRangeDto {
  @ApiPropertyOptional({ description: 'Valor mínimo' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  min?: number;

  @ApiPropertyOptional({ description: 'Valor máximo' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  max?: number;
}

// DTO para filtros de data
export class DateRangeDto {
  @ApiPropertyOptional({ description: 'Data inicial (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Data final (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  to?: string;
}

// DTO para filtros de marca
export class BrandFilterDto {
  @ApiPropertyOptional({ description: 'IDs das marcas', type: [Number] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  ids?: number[];

  @ApiPropertyOptional({ description: 'Nomes das marcas', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  names?: string[];

  @ApiPropertyOptional({ description: 'Nomes curtos das marcas', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shortNames?: string[];

  @ApiPropertyOptional({ description: 'Apenas marcas ativas' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;
}

// DTO para filtros de categoria
export class CategoryFilterDto {
  @ApiPropertyOptional({ description: 'IDs das categorias', type: [Number] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Type(() => Number)
  ids?: number[];

  @ApiPropertyOptional({ description: 'Nomes das categorias', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  names?: string[];

  @ApiPropertyOptional({ description: 'Status das categorias', enum: ProductStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ProductStatus, { each: true })
  status?: ProductStatus[];

  @ApiPropertyOptional({ description: 'ID da categoria pai' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  parentId?: number;

  @ApiPropertyOptional({ description: 'Apenas categorias ativas' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Incluir subcategorias' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeSubcategories?: boolean;
}

// DTO para filtros de inventário
export class InventoryFilterDto {
  @ApiPropertyOptional({ description: 'Range de quantidade', type: NumericRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NumericRangeDto)
  quantity?: NumericRangeDto;

  @ApiPropertyOptional({ description: 'Range de preço', type: NumericRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NumericRangeDto)
  price?: NumericRangeDto;

  @ApiPropertyOptional({ description: 'Status do inventário', enum: InventoryStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(InventoryStatus, { each: true })
  status?: InventoryStatus[];

  @ApiPropertyOptional({ description: 'Localizações', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @ApiPropertyOptional({ description: 'Apenas produtos com estoque disponível' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  hasStock?: boolean;

  @ApiPropertyOptional({ description: 'Quantidade mínima em estoque' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  minStock?: number;
}

// DTO para filtros de atributos
export class AttributeFilterDto {
  @ApiPropertyOptional({ description: 'Código do atributo' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: 'Valor do atributo' })
  @IsOptional()
  @IsString()
  value?: string;

  @ApiPropertyOptional({ description: 'Nome do atributo' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Tipo do valor' })
  @IsOptional()
  @IsString()
  valueType?: string;

  @ApiPropertyOptional({ description: 'ID do marketplace' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  marketplaceId?: number;

  @ApiPropertyOptional({ description: 'ID da categoria' })
  @IsOptional()
  @IsString()
  categoryId?: string;
}

// DTO para filtros de marketplace
export class MarketplaceFilterDto {
  @ApiPropertyOptional({ description: 'IDs dos marketplaces', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({ description: 'Nomes dos marketplaces', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  names?: string[];

  @ApiPropertyOptional({ description: 'Apenas marketplaces habilitados' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  enabled?: boolean;
}

// DTO para filtros de imagens
export class ImageFilterDto {
  @ApiPropertyOptional({ description: 'Apenas produtos com imagens' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  hasImages?: boolean;

  @ApiPropertyOptional({ description: 'Quantidade mínima de imagens' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  minImages?: number;

  @ApiPropertyOptional({ description: 'Status das imagens', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageStatus?: string[];
}

export class CompatibilityFilterDto {
  @ApiPropertyOptional({ description: 'IDs dos veículos', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleIds?: string[];

  @ApiPropertyOptional({ description: 'Marcas dos veículos', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleBrands?: string[];

  @ApiPropertyOptional({ description: 'Modelos dos veículos', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleModels?: string[];

  @ApiPropertyOptional({ description: 'Anos dos veículos', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleYears?: string[];

  @ApiPropertyOptional({ description: 'Tipos de combustível', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleFuelTypes?: string[];

  @ApiPropertyOptional({ description: 'Tipos de transmissão', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleTransmissions?: string[];

  @ApiPropertyOptional({ description: 'Status das compatibilidades', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  status?: string[];

  @ApiPropertyOptional({ description: 'Apenas compatibilidades sincronizadas com marketplace' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  syncedWithMarketplace?: boolean;

  @ApiPropertyOptional({ description: 'Apenas produtos com compatibilidades' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  hasCompatibilities?: boolean;
}

// DTO para ordenação
export class SortDto {
  @ApiPropertyOptional({
    description: 'Campo para ordenação',
    enum: ['id', 'name', 'partNumber', 'price', 'createdAt', 'updatedAt', 'brand.name', 'category.name']
  })
  @IsOptional()
  @IsString()
  field?: string;

  @ApiPropertyOptional({ description: 'Direção da ordenação', enum: ['ASC', 'DESC'] })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  direction?: 'ASC' | 'DESC';
}

// DTO para paginação
export class PaginationDto {
  @ApiPropertyOptional({ description: 'Página (começando em 1)', minimum: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Itens por página', minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

// DTO principal para filtros de produtos
export class ProductFilterDto {
  // Filtros básicos do produto
  @ApiPropertyOptional({ description: 'IDs dos produtos (ObjectId)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({ description: 'IDs internos do MongoDB', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mongoIds?: string[];

  @ApiPropertyOptional({ description: 'Nome do produto (busca parcial)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Número da peça' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ description: 'Código GTIN' })
  @IsOptional()
  @IsString()
  gtin?: string;

  @ApiPropertyOptional({ description: 'Status do produto', enum: ProductStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ProductStatus, { each: true })
  status?: ProductStatus[];

  @ApiPropertyOptional({ description: 'Apenas produtos genuínos' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isGenuine?: boolean;

  @ApiPropertyOptional({ description: 'Range de preço', type: NumericRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NumericRangeDto)
  price?: NumericRangeDto;

  @ApiPropertyOptional({ description: 'Range de peso', type: NumericRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NumericRangeDto)
  weight?: NumericRangeDto;

  @ApiPropertyOptional({ description: 'Range de data de criação', type: DateRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DateRangeDto)
  createdAt?: DateRangeDto;

  @ApiPropertyOptional({ description: 'Range de data de atualização', type: DateRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DateRangeDto)
  updatedAt?: DateRangeDto;

  // Filtros por relacionamentos
  @ApiPropertyOptional({ description: 'Filtros de marca', type: BrandFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandFilterDto)
  brand?: BrandFilterDto;

  @ApiPropertyOptional({ description: 'Filtros de categoria', type: CategoryFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CategoryFilterDto)
  category?: CategoryFilterDto;

  @ApiPropertyOptional({ description: 'Filtros de inventário', type: InventoryFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => InventoryFilterDto)
  inventory?: InventoryFilterDto;

  @ApiPropertyOptional({ description: 'Filtros de marketplace', type: MarketplaceFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MarketplaceFilterDto)
  marketplace?: MarketplaceFilterDto;

  @ApiPropertyOptional({ description: 'Filtros de imagens', type: ImageFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImageFilterDto)
  images?: ImageFilterDto;

  @ApiPropertyOptional({ description: 'Filtros de compatibilidades', type: CompatibilityFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompatibilityFilterDto)
  compatibilities?: CompatibilityFilterDto;

  // Filtros de atributos (array para múltiplos atributos)
  @ApiPropertyOptional({ description: 'Filtros de atributos', type: [AttributeFilterDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttributeFilterDto)
  attributes?: AttributeFilterDto[];

  // Busca textual geral
  @ApiPropertyOptional({ description: 'Busca textual geral (nome, partNumber, descrição)' })
  @IsOptional()
  @IsString()
  search?: string;

  // Incluir relacionamentos na resposta
  @ApiPropertyOptional({ description: 'Incluir dados da marca na resposta' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeBrand?: boolean;

  @ApiPropertyOptional({ description: 'Incluir dados da categoria na resposta' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeCategory?: boolean;

  @ApiPropertyOptional({ description: 'Incluir dados do inventário na resposta' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeInventory?: boolean;

  @ApiPropertyOptional({ description: 'Incluir imagens na resposta' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeImages?: boolean;

  @ApiPropertyOptional({ description: 'Incluir títulos na resposta' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeTitles?: boolean;

  @ApiPropertyOptional({ description: 'Incluir atributos na resposta' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeAttributes?: boolean;

  // Incluir compatibilidades na resposta
  @ApiPropertyOptional({ description: 'Incluir compatibilidades na resposta' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeCompatibilities?: boolean;

  // Parâmetros de ordenação diretos
  @ApiPropertyOptional({
    description: 'Campo para ordenação',
    enum: ['id', 'name', 'partNumber', 'price', 'createdAt', 'updatedAt', 'brand.name', 'category.name', 'compatibilities.count']
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ description: 'Direção da ordenação', enum: ['ASC', 'DESC'] })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortDirection?: 'ASC' | 'DESC';

  // Parâmetros de paginação diretos
  @ApiPropertyOptional({ description: 'Página (começando em 1)', minimum: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Itens por página', minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 10;

  // Ordenação
  @ApiPropertyOptional({ description: 'Configurações de ordenação', type: SortDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SortDto)
  sort?: SortDto;

  // Paginação
  @ApiPropertyOptional({ description: 'Configurações de paginação', type: PaginationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaginationDto)
  pagination?: PaginationDto;
}

// DTO para resposta paginada
export class PaginatedResponseDto<T> {
  @ApiPropertyOptional({ description: 'Dados da página atual' })
  data: T[];

  @ApiPropertyOptional({ description: 'Informações de paginação' })
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// DTO específico para resposta de produtos
export class ProductResponseDto extends PaginatedResponseDto<any> {
  @ApiPropertyOptional({ description: 'Lista de produtos' })
  data: any[];
}
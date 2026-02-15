import { IsString, IsArray, IsOptional, IsNumber, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export class KnownAttributeDto {
  @IsString()
  id: string;

  @IsArray()
  @IsString({ each: true })
  value_ids: string[];
}

export class CatalogCompatibilitySearchDto {
  @IsString()
  domain_id: string;

  @IsString()
  site_id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KnownAttributeDto)
  known_attributes: KnownAttributeDto[];

  @IsOptional()
  @IsNumber()
  limit?: number = 50;

  @IsOptional()
  @IsNumber()
  offset?: number = 0;

  // Método para validar se é uma requisição válida para veículos
  isValidVehicleRequest(): boolean {
    return this.domain_id === 'MLB-CARS_AND_VANS' && this.site_id === 'MLB';
  }

  // Método para obter atributos conhecidos como objeto
  getKnownAttributesAsObject(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    this.known_attributes.forEach(attr => {
      result[attr.id] = attr.value_ids;
    });
    return result;
  }

  // Método para verificar se tem um atributo específico
  hasAttribute(attributeId: string): boolean {
    return this.known_attributes.some(attr => attr.id === attributeId);
  }

  // Método para obter valores de um atributo específico
  getAttributeValues(attributeId: string): string[] {
    const attr = this.known_attributes.find(a => a.id === attributeId);
    return attr ? attr.value_ids : [];
  }
}
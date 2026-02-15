// DTO atualizado para melhor tipagem
export class GetCompatibilityFiltersDto {
  BRAND?: string;
  MODEL?: string;
  VEHICLE_YEAR?: string;
  VERSION?: string;
  ENGINE?: string;
  FUEL_TYPE?: string;
  TRANSMISSION?: string;
  BODY_STYLE?: string;

  // Método auxiliar para validar se há filtros
  hasFilters(): boolean {
    return Object.keys(this).some(key => this[key] !== undefined && this[key] !== '');
  }

  // Método para obter filtros preenchidos
  getFilledFilters(): Record<string, string> {
    const filled: Record<string, string> = {};
    Object.keys(this).forEach(key => {
      if (this[key] !== undefined && this[key] !== '') {
        filled[key] = this[key];
      }
    });
    return filled;
  }
}


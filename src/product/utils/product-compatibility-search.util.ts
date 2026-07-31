import { toLowerClean } from '../../vehicle-shared/utils/string.util';

interface ProductSearchInput {
  name?: string;
  partNumber?: string;
  oemCodes?: string[];
  attributes?: Array<{ code?: string; value?: string; valueName?: string }>;
}

interface VehicleSearchInput {
  make?: string;
  model?: string;
  version?: string;
  versionDisplay?: string;
  years?: number[];
  aliases?: string[];
}

/** attributeId usado para cross-reference de equivalência entre marcas de peça (curadoria manual). */
export const EQUIVALENT_OEM_ATTRIBUTE_ID = 'EQUIVALENT_OEM';

/**
 * Monta o searchText combinado de um vínculo produto↔veículo: nome/oemCodes/EQUIVALENT_OEM do
 * produto + marca/modelo/versão/ano/aliases do veículo. Alimenta a busca única em texto livre
 * ("palheta toro 2025") sem parsing determinístico — ver
 * docs/superpowers/specs/2026-07-09-product-vehicle-search-design.md, Seções 5, 6 e 9.
 */
export function buildProductCompatibilitySearchText(
  product: ProductSearchInput,
  vehicle?: VehicleSearchInput,
): string {
  const equivalentOemCodes = (product.attributes ?? [])
    .filter((a) => a.code === EQUIVALENT_OEM_ATTRIBUTE_ID)
    .map((a) => a.valueName ?? a.value)
    .filter((v): v is string => Boolean(v));

  const tokens = [
    product.name,
    product.partNumber,
    ...(product.oemCodes ?? []),
    ...equivalentOemCodes,
    vehicle?.make,
    vehicle?.model,
    vehicle?.versionDisplay ?? vehicle?.version,
    ...(vehicle?.years ?? []).map(String),
    ...(vehicle?.aliases ?? []),
  ]
    .map((s) => toLowerClean(String(s ?? '')))
    .filter(Boolean);

  return [...new Set(tokens)].join(' ');
}

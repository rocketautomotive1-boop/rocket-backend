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
  /** Quando presente, restringe os anos indexados na busca a este subconjunto —
   *  ver ProductCompatibilityModel.yearsOverride. */
  yearsOverride?: number[];
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

  // vehicle.aliases (deriveAliases) já embute CADA ano de vehicle.years como texto
  // (ex: "denza b5 gs 2026", "denza b5 gs 2027") — com yearsOverride presente,
  // um alias que menciona um ano fora do subconjunto tem que ser descartado aqui,
  // senão ele reintroduz no índice de busca exatamente o ano que o override
  // deveria excluir (bug real: yearsOverride:[2027] ainda indexava "2026" via
  // alias, confirmado ao vivo).
  const restrictedYears = vehicle?.yearsOverride?.length ? vehicle.yearsOverride : undefined;
  const excludedYears = restrictedYears
    ? (vehicle?.years ?? []).filter((y) => !restrictedYears.includes(y)).map(String)
    : [];
  const filteredAliases = (vehicle?.aliases ?? []).filter(
    (alias) => !excludedYears.some((y) => alias.includes(y)),
  );

  const tokens = [
    product.name,
    product.partNumber,
    ...(product.oemCodes ?? []),
    ...equivalentOemCodes,
    vehicle?.make,
    vehicle?.model,
    vehicle?.versionDisplay ?? vehicle?.version,
    ...(restrictedYears ?? vehicle?.years ?? []).map(String),
    ...filteredAliases,
  ]
    .map((s) => toLowerClean(String(s ?? '')))
    .filter(Boolean);

  return [...new Set(tokens)].join(' ');
}

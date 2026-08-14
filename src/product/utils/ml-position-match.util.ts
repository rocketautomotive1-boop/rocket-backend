export interface MlCatalogSearchResult {
  catalog_product_id: string;
  name: string;
  attributes?: Array<{ id: string; value_id?: string; value_name?: string }>;
}

export interface MlPositionMatchResult {
  catalogProductId: string | null;
  needsReview: boolean;
  position?: string;
  positionName?: string;
  sidePosition?: string;
  sidePositionName?: string;
}

function findAttr(result: MlCatalogSearchResult, attrId: string) {
  return result.attributes?.find((a) => a.id === attrId);
}

/**
 * Decide qual catalog_product_id (peça) aceitar a partir dos resultados de
 * /products/search, comparando por PART_NUMBER exato (case-insensitive).
 * Só aceita quando há exatamente 1 resultado com PART_NUMBER idêntico — qualquer
 * ambiguidade (0 ou 2+ matches) marca needsReview em vez de arriscar um match errado.
 */
export function resolvePositionMatch(
  results: MlCatalogSearchResult[],
  partNumber: string,
): MlPositionMatchResult {
  const target = partNumber.trim().toUpperCase();

  const exactMatches = results.filter((r) => {
    const pn = findAttr(r, 'PART_NUMBER')?.value_name;
    return pn != null && pn.trim().toUpperCase() === target;
  });

  if (exactMatches.length !== 1) {
    return { catalogProductId: null, needsReview: true };
  }

  const matched = exactMatches[0];
  const position = findAttr(matched, 'POSITION');
  const sidePosition = findAttr(matched, 'SIDE_POSITION');

  return {
    catalogProductId: matched.catalog_product_id,
    needsReview: false,
    position: position?.value_id,
    positionName: position?.value_name,
    sidePosition: sidePosition?.value_id,
    sidePositionName: sidePosition?.value_name,
  };
}

import { resolvePositionMatch, MlCatalogSearchResult } from './ml-position-match.util';

function result(overrides: Partial<MlCatalogSearchResult>): MlCatalogSearchResult {
  return {
    catalog_product_id: 'MLB1',
    name: 'Produto genérico',
    attributes: [],
    ...overrides,
  };
}

describe('resolvePositionMatch', () => {
  it('aceita match exato único de PART_NUMBER e extrai POSITION/SIDE_POSITION', () => {
    const results: MlCatalogSearchResult[] = [
      result({
        catalog_product_id: 'MLB37361266',
        attributes: [
          { id: 'PART_NUMBER', value_name: 'GBL1252' },
          { id: 'POSITION', value_id: '13701105', value_name: 'Traseira' },
          { id: 'SIDE_POSITION', value_id: '5365767', value_name: 'Esquerdo/Direito' },
        ],
      }),
    ];

    const match = resolvePositionMatch(results, 'GBL1252');

    expect(match).toEqual({
      catalogProductId: 'MLB37361266',
      needsReview: false,
      position: '13701105',
      positionName: 'Traseira',
      sidePosition: '5365767',
      sidePositionName: 'Esquerdo/Direito',
    });
  });

  it('é case-insensitive na comparação de PART_NUMBER', () => {
    const results: MlCatalogSearchResult[] = [
      result({
        catalog_product_id: 'MLB1',
        attributes: [{ id: 'PART_NUMBER', value_name: 'gbl1252' }],
      }),
    ];

    const match = resolvePositionMatch(results, 'GBL1252');

    expect(match.catalogProductId).toBe('MLB1');
    expect(match.needsReview).toBe(false);
  });

  it('aceita match exato mesmo sem POSITION/SIDE_POSITION no domínio (não é erro)', () => {
    const results: MlCatalogSearchResult[] = [
      result({
        catalog_product_id: 'MLB1',
        attributes: [{ id: 'PART_NUMBER', value_name: 'X1' }],
      }),
    ];

    const match = resolvePositionMatch(results, 'X1');

    expect(match).toEqual({
      catalogProductId: 'MLB1',
      needsReview: false,
      position: undefined,
      positionName: undefined,
      sidePosition: undefined,
      sidePositionName: undefined,
    });
  });

  it('marca needsReview quando nenhum resultado bate o PART_NUMBER', () => {
    const results: MlCatalogSearchResult[] = [
      result({ attributes: [{ id: 'PART_NUMBER', value_name: 'OUTRO' }] }),
    ];

    const match = resolvePositionMatch(results, 'GBL1252');

    expect(match).toEqual({ catalogProductId: null, needsReview: true });
  });

  it('marca needsReview quando não há resultados', () => {
    const match = resolvePositionMatch([], 'GBL1252');
    expect(match).toEqual({ catalogProductId: null, needsReview: true });
  });

  it('marca needsReview quando múltiplos resultados batem o mesmo PART_NUMBER', () => {
    const results: MlCatalogSearchResult[] = [
      result({ catalog_product_id: 'MLB1', attributes: [{ id: 'PART_NUMBER', value_name: 'GBL1252' }] }),
      result({ catalog_product_id: 'MLB2', attributes: [{ id: 'PART_NUMBER', value_name: 'GBL1252' }] }),
    ];

    const match = resolvePositionMatch(results, 'GBL1252');

    expect(match).toEqual({ catalogProductId: null, needsReview: true });
  });

  it('marca needsReview quando o resultado não tem atributo PART_NUMBER', () => {
    const results: MlCatalogSearchResult[] = [result({ attributes: [] })];

    const match = resolvePositionMatch(results, 'GBL1252');

    expect(match).toEqual({ catalogProductId: null, needsReview: true });
  });
});

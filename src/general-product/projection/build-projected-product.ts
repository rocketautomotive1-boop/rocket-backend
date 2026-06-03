import { deriveCompletion } from '../completion/derive-completion';

export interface ProjectedAttribute {
  id: string;
  name: string;
  value: string;
}

export interface ProjectedProductFields {
  partNumber: string;
  name: string;
  barcode: string;
  description: string;
  domain: 'general';
  active: boolean;
  price: number;
  images: any[];
  attributes: ProjectedAttribute[];
  tax: { ncm: string; cest: string; origin: string };
  readyToPublish: boolean;
}

const str = (v: any) => (typeof v === 'string' ? v.trim() : '');

/**
 * Mapeia um general_product (objeto puro) → campos a fazer `$set` no ProductModel
 * projetado (system-owned, domain:'general'). PURO (sem Mongoose). A categoria ML
 * é carregada como atributo `category_id` (é assim que o payload-builder do ML a
 * resolve quando não há CategoryModel). `mlCategoryId` vem de um listing (slice 3b);
 * ausente → sem atributo de categoria e `readyToPublish:false`.
 */
export function buildProjectedProductFields(
  general: any,
  mlCategoryId: string | undefined,
): ProjectedProductFields {
  const g = general ?? {};
  const barcode = str(g.barcode);

  const draftAttrs: ProjectedAttribute[] = Array.isArray(g.draftData?.attributes)
    ? g.draftData.attributes
        .filter((a: any) => a && (a.id || a.name))
        .map((a: any) => ({ id: str(a.id) || str(a.name), name: str(a.name) || str(a.id), value: str(a.value) }))
    : [];

  const attributes = mlCategoryId
    ? [...draftAttrs, { id: 'category_id', name: 'category_id', value: String(mlCategoryId) }]
    : draftAttrs;

  const completion = deriveCompletion(g);
  const readyToPublish =
    completion.dados && completion.imagens && completion.precoEstoque && completion.fiscal && !!mlCategoryId;

  const priceNum = Number(g.price);

  return {
    partNumber: `GEN-${barcode}`,
    name: str(g.name),
    barcode,
    description: str(g.description) || str(g.name),
    domain: 'general',
    active: true,
    price: Number.isFinite(priceNum) ? priceNum : 0,
    images: Array.isArray(g.images) ? g.images : [],
    attributes,
    tax: { ncm: str(g.ncm), cest: str(g.tax?.cest), origin: str(g.tax?.origin) },
    readyToPublish,
  };
}

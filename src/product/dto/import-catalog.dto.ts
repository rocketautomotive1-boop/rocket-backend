import { z } from 'zod';

/**
 * One row from tools/catalog-extractor output (CSV or JSON), describing a product
 * scraped from a manufacturer's desktop catalog app.
 *
 * `codigoOrigem` is the manufacturer's own product code — it becomes `partNumber`
 * on the Product document, which already has a unique+sparse index. Import is an
 * upsert keyed by `partNumber`, so re-running the same catalog export never
 * duplicates products.
 */
export const catalogCrossReferenceSchema = z.object({
  brand: z.string().min(1),
  partNumber: z.string().min(1),
});

export const catalogApplicationSchema = z.object({
  fabricante: z.string().min(1),
  modelo: z.string().min(1),
  complemento: z.string().nullable().optional(),
  periodo: z.string().nullable().optional(),
  motorizacao: z.string().nullable().optional(),
  posicaoMontagem: z.string().nullable().optional(),
});

export const catalogKitComponentSchema = z.object({
  partNumber: z.string().min(1),
  quantidade: z.number().nullable().optional(),
});

export const catalogAttributeSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  value: z.string().min(1),
});

export const importCatalogItemSchema = z.object({
  origemCatalogo: z.string().min(1, 'origemCatalogo é obrigatório'),
  codigoOrigem: z.string().min(1, 'codigoOrigem é obrigatório'),
  // Overrides the origemCatalogo->brand lookup (CATALOG_BRAND_NAME) for catalogs
  // that sell under multiple house brands (e.g. Schaeffler's LuK/INA/FAG/Ruville/
  // Vitesco — resolved per-product from the source catalog's own FABRICANTE FK,
  // not a single fixed brand per catalog).
  marcaProduto: z.string().nullable().optional(),
  tipoProduto: z.string().nullable().optional(),
  posicao: z.string().nullable().optional(),
  motorizacao: z.string().nullable().optional(),
  observacao: z.string().nullable().optional(),
  lancamento: z.boolean().optional(),
  lancamentoData: z.coerce.date().nullable().optional(),
  lancamentoValidade: z.coerce.date().nullable().optional(),
  promocao: z.boolean().optional(),
  promocaoData: z.coerce.date().nullable().optional(),
  promocaoValidade: z.coerce.date().nullable().optional(),
  pontaEstoque: z.boolean().optional(),
  corIdentificacao: z.string().nullable().optional(),
  imagensExtras: z.array(z.string()).default([]),
  // Cross-references WITH manufacturer attribution (e.g. {brand:'MONROE', partNumber:'27016'}) —
  // feeds CrossReferenceService.processCrossReferences, not the flat oemCodes cache directly.
  referenciasCruzadas: z.array(catalogCrossReferenceSchema).default([]),
  // Raw per-vehicle application rows (make+model+period+engine) — stored as-is on
  // Product.catalogApplications for a later matching step against vehicle_compatibilities.
  aplicacoesCatalogo: z.array(catalogApplicationSchema).default([]),
  arquivoImagem: z.string().nullable().optional(),
  // partNumbers of other products in the SAME catalog listed as similar/related
  // (e.g. Delphi's SIMILAR table). Stored as raw partNumber strings on
  // Product.catalogSimilarCodes — not resolved to ObjectIds at import time.
  codigosSimilares: z.array(z.string()).default([]),
  // Component products for a kit/set (e.g. Schaeffler's CONJ_PRODS — a RepSet
  // clutch kit listing disc/plate/bearing as separately-sold components).
  componentesKit: z.array(catalogKitComponentSchema).default([]),
  // partNumbers of other products sharing at least one vehicle application
  // with this one (e.g. Schaeffler's "Relacionados à Aplicação" — a
  // complementary part for the same fitment, not an obsolete/replacement pair).
  relacionadosAplicacao: z.array(z.string()).default([]),
  // GTIN/EAN-13 barcode, when the catalog provides one — written straight to
  // Product.barcode (not a catalog* field; it's real product data, and
  // `domain:'autopecas'` products have no unique constraint on it).
  gtin: z.string().nullable().optional(),
  pesoKg: z.number().nullable().optional(),
  dimensoesMm: z
    .object({ comprimento: z.number(), largura: z.number(), altura: z.number() })
    .nullable()
    .optional(),
  ncm: z.string().nullable().optional(),
  paisOrigem: z.string().nullable().optional(),
  estadoMaterial: z.string().nullable().optional(),
  // Raw per-product-type technical specs (e.g. Schaeffler's "Diâmetro do
  // Disco") with no fixed meaning catalog-wide — see ProductCatalogAttribute.
  atributosExtras: z.array(catalogAttributeSchema).default([]),
});

export const importCatalogRequestSchema = z.object({
  items: z.array(importCatalogItemSchema).min(1, 'items não pode ser vazio'),
});

export type ImportCatalogItem = z.infer<typeof importCatalogItemSchema>;
export type ImportCatalogRequest = z.infer<typeof importCatalogRequestSchema>;

export interface ImportCatalogResult {
  total: number;
  created: number;
  updated: number;
  errors: { codigoOrigem: string; message: string }[];
}

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
export const importCatalogItemSchema = z.object({
  origemCatalogo: z.string().min(1, 'origemCatalogo é obrigatório'),
  codigoOrigem: z.string().min(1, 'codigoOrigem é obrigatório'),
  tipoProduto: z.string().nullable().optional(),
  marcaVeiculo: z.string().nullable().optional(),
  aplicacao: z.string().nullable().optional(),
  posicao: z.string().nullable().optional(),
  motorizacao: z.string().nullable().optional(),
  referenciasCruzadas: z.array(z.string()).default([]),
  arquivoImagem: z.string().nullable().optional(),
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

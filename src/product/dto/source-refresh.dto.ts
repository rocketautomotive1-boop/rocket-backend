import { z } from 'zod';

/** Fontes que podem ser atualizadas isoladamente. Espelha SourceName do discovery.
 *  Só 'menorPreco' é implementado end-to-end hoje; 'ml'/'serp' entram depois. */
export const SOURCE_NAMES = ['menorPreco', 'ml', 'serp'] as const;

export const SourceNameSchema = z.enum(SOURCE_NAMES, {
  errorMap: () => ({ message: `Fonte inválida. Use uma de: ${SOURCE_NAMES.join(', ')}.` }),
});
export type SourceName = z.infer<typeof SourceNameSchema>;

export function parseSourceName(value: unknown): SourceName {
  return SourceNameSchema.parse(value);
}

/** Bloco autocontido recebido do discovery — espelha SourceBlock (MenorPrecoBlock hoje). */
export interface SourceBlock {
  stats: { min: number | null; avg: number | null; max: number | null; count: number } | null;
  offers: unknown[];
}

/** Request publicada para o discovery (rocket.inventory / discovery.source.refresh). */
export interface SourceRefreshRequest {
  productId: string;
  source: SourceName;
  barcode: string;
  correlationId: string;
  jobId: string;
}

/** Response consumida do discovery (rocket.inventory / discovery.source.refresh.response). */
export interface SourceRefreshResponse {
  productId: string;
  source: SourceName;
  correlationId: string;
  jobId: string;
  block: SourceBlock | null;
  error?: string;
}

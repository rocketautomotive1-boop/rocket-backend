/** Contrato do fluxo menor_preco com o scraper Python (models.py). */
export const SCRAPER_EXCHANGE = 'rocket.scraper';
export const MENOR_PRECO_REQUEST_RK = 'menor_preco.request';
/** Fila de resposta EXCLUSIVA do tracker — o default (menor_preco.result) é do discovery. */
export const TRACKER_RESULT_RK = 'menor_preco.result.tracker';

export interface MenorPrecoRequest {
  job_id: string;
  correlation_id: string;
  gtin: string;
  local?: string;
  raio?: number;
  reply_to?: string;
}

export interface MenorPrecoOffer {
  seller_name?: string | null;
  legal_name?: string | null;
  address?: string | null;
  bairro?: string | null;
  mun?: string | null;
  uf?: string | null;
  price?: number | null;
  list_price?: number | null;
  sold_at?: string | null;
  dist_km?: number | null;
}

export interface MenorPrecoStats {
  min?: number | null;
  avg?: number | null;
  max?: number | null;
  count: number;
}

export interface MenorPrecoResult {
  correlation_id: string;
  ean: string;
  stats?: MenorPrecoStats | null;
  offers: MenorPrecoOffer[];
  error?: string | null;
}

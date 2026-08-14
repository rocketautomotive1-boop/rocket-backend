/**
 * Filtro de outliers por oferta individual — funções PURAS (sem Mongo/Nest).
 *
 * Caso motivador: item vendido em fardo/unidade fracionada gera preço real mas
 * não-comparável (ex: 1 unidade avulsa de um fardo de 12 unidades) — sem
 * filtro, essa oferta vira `bestOffer` só por ser a mais barata do ciclo,
 * disparando alerta de "oferta" que na prática é uma unidade de medida
 * diferente. O mesmo padrão cobre erro de digitação de NFC-e (produto de
 * R$100 lançado por R$1 ou R$10.000).
 *
 * Comparação é sempre contra o `movingAvg` do item — a mesma mediana
 * histórica de 14d que já baseia o gatilho `below_moving_avg` (ver
 * price-analysis.ts) — não contra o próprio ciclo, pra não ser injusto com
 * mercados com poucos vendedores/preços dispersos.
 */

/** Oferta ≤ 20% da média → suspeita ("80% mais barata"). */
export const OUTLIER_MIN_PCT = Number(process.env.PRICE_TRACKER_OUTLIER_MIN_PCT ?? 0.2);
/** Oferta ≥ 600% da média → suspeita ("500% mais cara"). */
export const OUTLIER_MAX_PCT = Number(process.env.PRICE_TRACKER_OUTLIER_MAX_PCT ?? 6.0);

export interface OutlierInput {
  price: number | null;
}

export type FlaggedOffer<T extends OutlierInput> = T & { suspicious: boolean };

/**
 * Marca cada oferta como suspeita ou não (nunca remove da lista — quem decide
 * o que fazer com uma oferta suspeita é o chamador). Sem `movingAvg` ainda
 * (item novo, abaixo de MIN_SNAPSHOTS), o filtro fica inativo: nenhuma oferta
 * é marcada, mesma guarda que já existe pros gatilhos de alerta.
 */
export function filterOutliers<T extends OutlierInput>(
  offers: T[],
  movingAvg: number | null,
): FlaggedOffer<T>[] {
  return offers.map((offer) => {
    if (movingAvg == null || offer.price == null) {
      return { ...offer, suspicious: false };
    }
    const suspicious =
      offer.price < movingAvg * OUTLIER_MIN_PCT || offer.price > movingAvg * OUTLIER_MAX_PCT;
    return { ...offer, suspicious };
  });
}

export interface RecomputedStats {
  median: number | null;
  avg: number | null;
  count: number;
}

// Espelha _round2_halfup do scraper Python (menor_preco_service.py) — mesmo
// arredondamento half-up usado lá pra median/avg, evitando divergência de
// ponto flutuante entre as duas implementações.
const round2HalfUp = (x: number) => Math.floor(x * 100 + 0.5) / 100;

/**
 * Recalcula median/avg/count a partir só das ofertas NÃO-suspeitas — sobrescreve
 * o que veio da API/scraper (que soma TODAS as ofertas, incluindo outliers).
 * stats.min/max não entram aqui: continuam vindo direto da API (extremo
 * agregado do GTIN, base do gatilho all_time_low — não filtrado de propósito).
 */
export function recomputeStats<T extends OutlierInput>(
  flagged: FlaggedOffer<T>[],
): RecomputedStats {
  const prices = flagged
    .filter((o) => !o.suspicious && o.price != null)
    .map((o) => o.price as number)
    .sort((a, b) => a - b);

  if (!prices.length) return { median: null, avg: null, count: 0 };

  const avg = round2HalfUp(prices.reduce((a, b) => a + b, 0) / prices.length);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2
    ? prices[mid]
    : round2HalfUp((prices[mid - 1] + prices[mid]) / 2);

  return { median, avg, count: prices.length };
}

/**
 * Inteligência do Caçador de Promoções — funções PURAS (sem Mongo/Nest).
 * Compara o "melhor preço de hoje" (stats.min do ciclo) com o "preço de mercado
 * típico" (média móvel da MEDIANA histórica, não do mínimo). Guardas evitam
 * "metade do dobro".
 *
 * Por que mediana e não mínimo: o mínimo de um ciclo é o menor preço entre
 * ~450 ofertas — basta UM vendedor fazer uma promoção relâmpago (ou errar o
 * preço) pra esse valor entrar na "média móvel" e ficar puxando-a pra baixo
 * por 14 dias, mascarando o gatilho de desconto (ele nunca mais dispara porque
 * a "média" já baixou artificialmente). A mediana ignora esse tipo de outlier
 * pontual — reflete o preço que a maioria dos vendedores pratica.
 */

export const MOVING_AVG_DAYS = 14;
export const MIN_SNAPSHOTS = 5;
export const REALERT_DROP_FACTOR = 0.95;

export interface SnapshotPoint {
  min: number | null;
  /** Mediana das ofertas do ciclo — usada como base do "preço de mercado" (movingAvg). */
  median: number | null;
  count: number;
  scannedAt: Date;
  error?: string | null;
}

export interface PriceAnalysis {
  /** Média móvel da MEDIANA histórica — o "preço de mercado típico" recente. */
  movingAvg: number | null;
  /** Menor preço já visto (extremo, não mediana) — usado só no gatilho all_time_low. */
  allTimeLow: number | null;
  validSnapshots: number;
}

export type AlertReason = 'below_target' | 'all_time_low' | 'below_moving_avg';

export interface TriggerInput {
  current: number;
  currentCount: number;
  analysis: PriceAnalysis;
  targetPrice?: number | null;
  thresholdPct: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Snapshots utilizáveis: sem erro e com min numérico. */
const validPoints = (points: SnapshotPoint[]): SnapshotPoint[] =>
  points.filter((p) => !p.error && p.min != null);

export function computeAnalysis(points: SnapshotPoint[], now: Date): PriceAnalysis {
  const valid = validPoints(points);
  if (!valid.length) {
    return { movingAvg: null, allTimeLow: null, validSnapshots: 0 };
  }

  const cutoff = new Date(now.getTime() - MOVING_AVG_DAYS * 86_400_000);
  // Base da média móvel é a MEDIANA (não o min) — robusta a promoção relâmpago
  // isolada de um único vendedor. Snapshot sem mediana (dado legado) é ignorado
  // na janela em vez de quebrar o cálculo.
  const window = valid
    .filter((p) => p.scannedAt >= cutoff && p.median != null)
    .map((p) => p.median as number);
  const movingAvg = window.length
    ? round2(window.reduce((a, b) => a + b, 0) / window.length)
    : null;

  const allTimeLow = Math.min(...valid.map((p) => p.min as number));

  return { movingAvg, allTimeLow, validSnapshots: valid.length };
}

/** Avalia os gatilhos NA ORDEM do spec; o primeiro que casa define o reason. */
export function evaluateTriggers(input: TriggerInput): AlertReason | null {
  const { current, currentCount, analysis, targetPrice, thresholdPct } = input;

  // 1) Teto explícito do usuário — funciona desde o 1º ciclo, sem histórico.
  if (targetPrice != null && current <= targetPrice) return 'below_target';

  // Guarda anti-"metade do dobro": sem base histórica mínima não há promoção.
  // A mediana (não o min) já protege contra outlier de 1 vendedor — não é
  // necessário também esperar dias civis distintos passarem.
  if (analysis.validSnapshots < MIN_SNAPSHOTS) return null;

  // 2) Menor preço já visto.
  if (analysis.allTimeLow != null && current < analysis.allTimeLow) return 'all_time_low';

  // 3) Abaixo da média móvel — exige >= 2 estabelecimentos no ciclo atual.
  if (currentCount < 2) return null;
  if (
    analysis.movingAvg != null &&
    current <= analysis.movingAvg * (1 - thresholdPct / 100)
  ) {
    return 'below_moving_avg';
  }

  return null;
}

/** Em oferta contínua, só re-alerta se cair mais 5% abaixo do preço do último alerta. */
export function shouldRealert(lastAlertPrice: number, current: number): boolean {
  return current <= lastAlertPrice * REALERT_DROP_FACTOR;
}

export const WINDOW_LOW_DAYS = [7, 30, 90] as const;
export type WindowLows = Record<'d7' | 'd30' | 'd90', number | null>;

/**
 * Menor preço em janelas 7/30/90 dias — bloco textual estilo CamelCamelCamel
 * ("Lowest recorded price"), mais intuitivo pro usuário leigo que a média móvel.
 */
export function computeWindowLows(points: SnapshotPoint[], now: Date): WindowLows {
  const valid = validPoints(points);
  const lowFor = (days: number): number | null => {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const window = valid.filter((p) => p.scannedAt >= cutoff).map((p) => p.min as number);
    return window.length ? Math.min(...window) : null;
  };
  return { d7: lowFor(7), d30: lowFor(30), d90: lowFor(90) };
}

import { VEHICLE_CONSTANTS } from '../constants/vehicle.constants';
import { normalizeDisplacementCc, normalizeFuelTags } from './vehicle-normalizer.util';

/**
 * `periodo` do catálogo de fabricante vem como "2000/2019" (faixa fechada) ou "2018/" (sem fim —
 * segue em produção), nunca com separador diferente de "/". Sem "/" ou vazio: sem filtro de ano
 * (linha vale para qualquer ano do make/model).
 */
export function parsePeriodoToYearRange(periodo?: string): { from: number; to: number } | undefined {
  if (!periodo?.trim()) return undefined;

  const [fromRaw, toRaw] = periodo.split('/').map((p) => p.trim());
  const from = Number(fromRaw);
  if (!Number.isFinite(from)) return undefined;

  const to = toRaw && Number.isFinite(Number(toRaw)) ? Number(toRaw) : VEHICLE_CONSTANTS.MAX_PRODUCTION_YEAR;

  return from <= to ? { from, to } : undefined;
}

/**
 * `motorizacao` às vezes lista mais de um motor na mesma linha (ex. "1.0/1.3/1.5 FIRE-FIASA"
 * visto no catálogo Valclei) — extrai todas as cilindradas presentes como alternativas (OR),
 * não só a primeira, senão a linha perderia match contra veículos com os outros motores citados.
 */
export function extractDisplacementsCc(motorizacao?: string): number[] {
  if (!motorizacao?.trim()) return [];

  const ccMatches = [...motorizacao.matchAll(/(\d+(?:[.,]\d+)?)\s*cc/gi)].map((m) =>
    normalizeDisplacementCc(`${m[1]}cc`),
  );
  if (ccMatches.some((v) => v !== undefined)) {
    return [...new Set(ccMatches.filter((v): v is number => v !== undefined))];
  }

  const literMatches = [...motorizacao.matchAll(/\b(\d)[.,](\d)\b/g)].map((m) =>
    normalizeDisplacementCc(`${m[1]}.${m[2]}`),
  );
  return [...new Set(literMatches.filter((v): v is number => v !== undefined))];
}

export interface VehicleCandidate {
  vehicleId: string;
  displacementCc?: number;
  fuelType?: string;
}

export interface CatalogApplicationMatchResult {
  /** Candidatos aceitos com motor batendo (ou sem motor pra comparar de nenhum dos dois lados). */
  matched: string[];
  /**
   * Candidatos aceitos só por make+model+ano — motor não pôde ser confirmado por falta de dado
   * de um dos lados (ex.: candidato sem displacementCc cadastrado), não por divergência.
   */
  needsReview: string[];
  /**
   * Candidatos com motor EXPLICITAMENTE divergente (cilindrada diferente, ou nenhuma fuel tag em
   * comum, com dado presente nos dois lados) — descartados, não criam compatibilidade nenhuma.
   * Não é ambíguo, não precisa de revisão manual: a linha do catálogo já disse qual motor é.
   */
  rejected: string[];
}

type EngineComparison = 'match' | 'mismatch' | 'unknown';

/**
 * 'mismatch' só quando os dois lados têm dado E divergem — essa é a única divergência que
 * desqualifica o candidato de vez (rejected). 'unknown' quando falta dado de um dos lados: não
 * dá pra confirmar nem descartar, então o candidato ainda é criado, mas pra revisão manual.
 */
function compareEngine(lineDisplacements: number[], lineFuelTags: string[], candidate: VehicleCandidate): EngineComparison {
  let hasUnknown = false;

  // Só "unknown" quando a LINHA do catálogo pede um motor específico mas o candidato não tem o
  // dado correspondente pra confirmar — quando a linha não menciona motor algum, não há nada
  // pedido pra confirmar ou contradizer, então segue como match independente do candidato.
  if (lineDisplacements.length > 0 && candidate.displacementCc !== undefined) {
    if (!lineDisplacements.includes(candidate.displacementCc)) return 'mismatch';
  } else if (lineDisplacements.length > 0 && candidate.displacementCc === undefined) {
    hasUnknown = true;
  }

  if (lineFuelTags.length > 0 && candidate.fuelType) {
    const candidateTags = normalizeFuelTags(candidate.fuelType);
    if (!candidateTags.some((t) => lineFuelTags.includes(t))) return 'mismatch';
  } else if (lineFuelTags.length > 0 && !candidate.fuelType) {
    hasUnknown = true;
  }

  return hasUnknown ? 'unknown' : 'match';
}

/**
 * Classifica candidatos já filtrados por make+model+ano (a query em vehicle_compatibilities é
 * responsabilidade do caller, que tem acesso ao Model) em três baldes: motor confirmado, motor
 * não confirmável (falta dado, precisa de revisão) e motor explicitamente diferente (descartado
 * — ver rejected acima).
 */
export function classifyCandidatesByEngine(
  motorizacao: string | undefined,
  candidates: VehicleCandidate[],
): CatalogApplicationMatchResult {
  const lineDisplacements = extractDisplacementsCc(motorizacao);
  const lineFuelTags = normalizeFuelTags(motorizacao);

  const matched: string[] = [];
  const needsReview: string[] = [];
  const rejected: string[] = [];

  for (const candidate of candidates) {
    const comparison = compareEngine(lineDisplacements, lineFuelTags, candidate);
    if (comparison === 'match') matched.push(candidate.vehicleId);
    else if (comparison === 'unknown') needsReview.push(candidate.vehicleId);
    else rejected.push(candidate.vehicleId);
  }

  return { matched, needsReview, rejected };
}

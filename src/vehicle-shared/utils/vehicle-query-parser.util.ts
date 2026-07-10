import { collapseSpaces } from './string.util';
import { normalizeDisplacementCc, normalizeFuelTags } from './vehicle-normalizer.util';

export interface ParsedVehicleQuery {
  freeText: string;
  yearRange?: { from: number; to: number };
  fuelTags?: string[];
  displacementCc?: number;
}

const YEAR_RANGE_RE = /\b(\d{4})\s*-\s*(\d{4})\b/;
const DISPLACEMENT_RE = /\b\d\.\d\b/;

/**
 * Separa uma query de busca livre de veículo ("Fiat Toro 2.0 2016-2021 Diesel") em tokens
 * estruturados (faixa de ano, combustível, cilindrada) e o texto restante (make/model/version),
 * independente da ordem em que os termos aparecem.
 */
export function parseVehicleQuery(raw: string): ParsedVehicleQuery {
  let remaining = raw ?? '';

  let yearRange: { from: number; to: number } | undefined;
  const yearMatch = remaining.match(YEAR_RANGE_RE);
  if (yearMatch) {
    const a = parseInt(yearMatch[1], 10);
    const b = parseInt(yearMatch[2], 10);
    yearRange = { from: Math.min(a, b), to: Math.max(a, b) };
    remaining = remaining.replace(YEAR_RANGE_RE, ' ');
  }

  const fuelTags: string[] = [];
  const remainingTokens: string[] = [];
  for (const token of remaining.split(/\s+/).filter(Boolean)) {
    const tags = normalizeFuelTags(token);
    if (tags.length > 0) {
      fuelTags.push(...tags);
    } else {
      remainingTokens.push(token);
    }
  }
  remaining = remainingTokens.join(' ');

  let displacementCc: number | undefined;
  const displacementMatch = remaining.match(DISPLACEMENT_RE);
  if (displacementMatch) {
    displacementCc = normalizeDisplacementCc(displacementMatch[0]);
    remaining = remaining.replace(DISPLACEMENT_RE, ' ');
  }

  return {
    freeText: collapseSpaces(remaining),
    yearRange,
    fuelTags: fuelTags.length > 0 ? [...new Set(fuelTags)] : undefined,
    displacementCc,
  };
}

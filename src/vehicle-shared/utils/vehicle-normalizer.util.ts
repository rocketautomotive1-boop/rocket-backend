import { VEHICLE_CONSTANTS } from '../constants/vehicle.constants';
import {
  collapseSpaces,
  removeAccents,
  toLowerClean,
  tokenize,
} from './string.util';

const MAKE_CANONICAL: Record<string, string> = {
  vw: 'volkswagen',
  'vw/audi': 'volkswagen',
  gm: 'general motors',
  fca: 'stellantis',
  mercedes: 'mercedes-benz',
  'mercedes-benz': 'mercedes-benz',
  land_rover: 'land rover',
  landrover: 'land rover',
};

const VERSION_NOISE_TOKENS = new Set([
  'flex',
  'gasolina',
  'etanol',
  'diesel',
  'automatico',
  'manual',
  'cvt',
  'automatizada',
  'nacional',
  'importado',
]);

export function normalizeMake(make: string): string {
  if (!make) return '';
  const clean = toLowerClean(make).replace(/\s+/g, '_');
  return MAKE_CANONICAL[clean] ?? toLowerClean(make);
}

export function normalizeModel(model: string): string {
  return toLowerClean(model ?? '');
}

export function normalizeVersionDisplay(version: string): string {
  return collapseSpaces(removeAccents(version ?? '')).toLowerCase();
}

export function normalizeEngineTokens(engineStr: string): string[] {
  return tokenize(engineStr ?? '');
}

/** Extrai cilindrada em cc de formato bruto ("1000 cc", "1.0", "1,4", "2000cc") → undefined se irreconhecível. */
export function normalizeDisplacementCc(raw?: string): number | undefined {
  if (!raw) return undefined;
  const str = raw.toLowerCase().trim();

  const ccMatch = str.match(/(\d+(?:[.,]\d+)?)\s*cc/);
  if (ccMatch) {
    const cc = parseFloat(ccMatch[1].replace(',', '.'));
    return Number.isFinite(cc) ? Math.round(cc) : undefined;
  }

  const litersMatch = str.match(/\b(\d)[.,](\d)\b/);
  if (litersMatch) {
    const liters = parseFloat(`${litersMatch[1]}.${litersMatch[2]}`);
    return Number.isFinite(liters) ? Math.round(liters * 1000) : undefined;
  }

  return undefined;
}

const FUEL_TAG_DICTIONARY: Array<{ tag: string; substrings: string[] }> = [
  { tag: 'diesel', substrings: ['diesel'] },
  { tag: 'gasoline', substrings: ['gasolina', 'gasol'] },
  { tag: 'ethanol', substrings: ['alcool', 'etanol'] },
  { tag: 'flex', substrings: ['flex'] },
  { tag: 'hybrid', substrings: ['hibrid'] },
  { tag: 'electric', substrings: ['eletric'] },
  { tag: 'cng', substrings: ['gnv', 'gas natural', 'cng'] },
];

/** Mapeia texto livre de combustível (PT-BR, incl. compostos "X e Y", "X/Y") pra tags do VehicleFuelType. */
export function normalizeFuelTags(raw?: string): string[] {
  if (!raw) return [];
  const str = removeAccents(raw).toLowerCase();

  const tags = FUEL_TAG_DICTIONARY.filter(({ substrings }) =>
    substrings.some((s) => str.includes(s)),
  ).map(({ tag }) => tag);

  return [...new Set(tags)];
}

export function normalizeVersionForKey(version: string): string {
  return tokenize(version ?? '')
    .filter((t) => !VERSION_NOISE_TOKENS.has(t))
    .sort()
    .join('_');
}

export function generateVersionStandard(
  make: string,
  model: string,
  version: string,
): string {
  return [normalizeMake(make), normalizeModel(model), normalizeVersionDisplay(version)]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, '-')
    .trim();
}

export function generateEngineSignature(engine?: {
  family?: string;
  displacement?: string;
  aspiration?: string;
  fuelType?: string;
}): string {
  if (!engine) return '';

  const toNormalizedToken = (
    value: unknown,
    replacer?: (v: string) => string,
  ): string => {
    if (value === null || value === undefined) return '';
    const str = String(value).toLowerCase().trim();
    if (!str) return '';
    return replacer ? replacer(str) : str;
  };

  const parts = [
    toNormalizedToken(engine.family, (v) => v.replace(/[\s/]/g, '_')),
    toNormalizedToken(engine.displacement, (v) => v.replace(/\s+/g, '_')),
    toNormalizedToken(engine.aspiration),
    toNormalizedToken(engine.fuelType),
  ].filter(Boolean);
  return parts.join('_');
}

export function generateCanonicalKey(
  make: string,
  model: string,
  version: string,
  engineSignature: string,
  market: string,
  years: number[] = [],
): string {
  return [
    normalizeMake(make),
    normalizeModel(model),
    normalizeVersionForKey(version),
    (engineSignature ?? '').toLowerCase().trim(),
    (market ?? '').toLowerCase().trim(),
    [...years].sort((a, b) => a - b).join('_'),
  ].join(':');
}

export function deriveAliases(
  make: string,
  model: string,
  version: string,
  years: number[] = [],
): string[] {
  const mk = normalizeMake(make);
  const md = normalizeModel(model);
  const vs = normalizeVersionDisplay(version);
  const base = [`${mk} ${md}`.trim(), `${mk} ${md} ${vs}`.trim()];
  const withYears = years.flatMap((y) => [
    `${mk} ${md} ${y}`.trim(),
    `${mk} ${md} ${vs} ${y}`.trim(),
  ]);
  return [...new Set([...base, ...withYears])].filter(Boolean);
}

export function validateYearRange(years: number[]): { valid: boolean; reason?: string } {
  if (!years?.length) return { valid: false, reason: 'empty_years' };
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (
    min < VEHICLE_CONSTANTS.MIN_PRODUCTION_YEAR ||
    max > VEHICLE_CONSTANTS.MAX_PRODUCTION_YEAR
  ) {
    return {
      valid: false,
      reason: `invalid_year_range:${min}-${max}`,
    };
  }
  return { valid: true };
}

export function buildSearchText(
  make: string,
  model: string,
  version: string,
  aliases: string[] = [],
  tags: string[] = [],
): string {
  const tokens = [
    make,
    model,
    version,
    ...(aliases ?? []),
    ...(tags ?? []),
  ]
    .map((s) => toLowerClean(s ?? ''))
    .filter(Boolean);

  return [...new Set(tokens)].join(' ');
}

export function computeDataQualityScore(input: {
  make?: string;
  model?: string;
  version?: string;
  productionYears?: number[];
  engine?: {
    family?: string;
    displacement?: string;
    fuelType?: string;
  };
  transmission?: string[];
  bodyType?: string;
  platform?: string;
  fipe?: {
    code?: string;
  };
  aliases?: string[];
}): number {
  let score = 0;
  if (input.make) score += 15;
  if (input.model) score += 15;
  if (input.version) score += 10;
  if (input.productionYears?.length) score += 12;
  if (input.engine?.family) score += 10;
  if (input.engine?.displacement) score += 8;
  if (input.engine?.fuelType) score += 10;
  if (input.transmission?.length) score += 6;
  if (input.bodyType) score += 4;
  if (input.platform) score += 4;
  if (input.fipe?.code) score += 4;
  if (input.aliases?.length) score += 2;
  return Math.max(0, Math.min(100, score));
}


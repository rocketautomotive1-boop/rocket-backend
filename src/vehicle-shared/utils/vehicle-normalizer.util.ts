import { createHash } from 'crypto';
import { VEHICLE_CONSTANTS } from '../constants/vehicle.constants';
import { VehicleAiOutput } from '../types/vehicle.types';
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
): string {
  return [
    normalizeMake(make),
    normalizeModel(model),
    normalizeVersionForKey(version),
    (engineSignature ?? '').toLowerCase().trim(),
    (market ?? '').toLowerCase().trim(),
  ].join(':');
}

export function generateLockKey(
  make: string,
  model: string,
  version: string,
  sourceItemId?: string,
  source?: string,
  title?: string,
  engineRaw?: string,
): string {
  const hasStructural = make?.trim() && model?.trim() && version?.trim();

  if (hasStructural) {
    return [
      normalizeMake(make),
      normalizeModel(model),
      normalizeVersionDisplay(version),
      (source ?? '').toLowerCase(),
      (sourceItemId ?? '').toLowerCase(),
    ]
      .filter(Boolean)
      .map((p) => p.replace(/\s+/g, '_'))
      .join(':');
  }

  const hashInput = [
    normalizeMake(make),
    normalizeModel(model),
    title ?? '',
    engineRaw ?? '',
    source ?? '',
    sourceItemId ?? '',
  ]
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean)
    .join('|');

  const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 20);
  return `fallback:${hash}`;
}

export function generateAiCacheKey(input: {
  make?: string;
  model?: string;
  version?: string;
  title?: string;
  engine?: string;
}): string {
  const make = normalizeMake(input.make ?? '');
  const model = normalizeModel(input.model ?? '');
  const version = normalizeVersionForKey(input.version ?? '');
  if (make && model && version) {
    return `v1:${make}:${model}:${version}`;
  }
  const hashInput = [
    make,
    model,
    input.title ?? '',
    input.engine ?? '',
  ]
    .map((v) => toLowerClean(v))
    .filter(Boolean)
    .join('|');
  const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 20);
  return `v1:fallback:${hash}`;
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

export function normalizeConfidence(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
  }

  const raw = String(value).trim().toLowerCase();
  if (!raw) return undefined;

  if (raw === 'high') return 0.9;
  if (raw === 'medium' || raw === 'med' || raw === 'mid') return 0.6;
  if (raw === 'low') return 0.3;

  const parsed = Number(raw.replace(',', '.'));
  if (!Number.isFinite(parsed)) return undefined;

  // Accept percentages and normalize to 0..1
  if (parsed > 1 && parsed <= 100) return Math.max(0, Math.min(1, parsed / 100));
  return Math.max(0, Math.min(1, parsed));
}

export function aiOutputToCanonicalInput(ai: VehicleAiOutput): {
  make?: string;
  model?: string;
  version?: string;
  years?: number[];
} {
  return {
    make: ai.make,
    model: ai.model,
    version: ai.version,
    years: ai.productionYears,
  };
}

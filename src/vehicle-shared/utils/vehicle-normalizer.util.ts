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

/** Extrai a cilindrada como string de exibição do texto de version ("1.0 5p" -> "1.0") → undefined se irreconhecível. */
export function extractEngineDisplay(version: string): string | undefined {
  if (!version) return undefined;
  const match = version.match(/\b(\d[.,]\d)\b/);
  if (!match) return undefined;
  return match[1].replace(',', '.');
}

const FUEL_TAG_DICTIONARY: Array<{ tag: string; substrings: string[] }> = [
  { tag: 'diesel', substrings: ['diesel'] },
  { tag: 'gasoline', substrings: ['gasolina', 'gasol'] },
  { tag: 'ethanol', substrings: ['alcool', 'etanol'] },
  { tag: 'hybrid', substrings: ['hibrid'] },
  { tag: 'electric', substrings: ['eletric'] },
  { tag: 'cng', substrings: ['gnv', 'gas natural', 'cng'] },
];

/**
 * "flex" no PT-BR significa "aceita gasolina e álcool" — os registros nunca são gravados com a
 * tag literal 'flex' (o campo fuelType vem como "Gasolina e álcool" e normaliza para
 * ['gasoline','ethanol']). Por isso o token de busca "flex" precisa expandir para as duas tags
 * reais, senão o filtro fuelTags nunca casa com nenhum documento.
 */
const FLEX_SUBSTRINGS = ['flex'];
const FLEX_EXPANSION = ['gasoline', 'ethanol'];

/** Mapeia texto livre de combustível (PT-BR, incl. compostos "X e Y", "X/Y") pra tags do VehicleFuelType. */
export function normalizeFuelTags(raw?: string): string[] {
  if (!raw) return [];
  const str = removeAccents(raw).toLowerCase();

  const tags = FUEL_TAG_DICTIONARY.filter(({ substrings }) =>
    substrings.some((s) => str.includes(s)),
  ).map(({ tag }) => tag);

  if (FLEX_SUBSTRINGS.some((s) => str.includes(s))) {
    tags.push(...FLEX_EXPANSION);
  }

  return [...new Set(tags)];
}

const TRACTION_RE = /\b(4x4|4wd|4x2|awd)\b/i;

const TRIM_STRIP_PATTERNS: RegExp[] = [
  /\b\d+(?:[.,]\d+)?\s*cc\b/gi,
  /\b\d[.,]\d\b/g,
  /\b\d\s*p\b/gi,
  /\bflex\b/gi,
  /\bgasolina\b/gi,
  /\bgasol\b/gi,
  /\b[ae]lcool\b/gi,
  /\betanol\b/gi,
  /\bhibrid[oa]?\b/gi,
  /\beletric[oa]?\b/gi,
  /\bgnv\b/gi,
  /\bgas natural\b/gi,
  /\bcng\b/gi,
  /\bdiesel\b/gi,
  /\baut\.?\b/gi,
  /\bautomatic[ao]\b/gi,
  /\bautomatizada\b/gi,
  /\bsequencial\b/gi,
  /\bsemiautomatic[ao]\b/gi,
  /\bmanual\b/gi,
  /\bcvt\b/gi,
  /\b4x4\b/gi,
  /\b4wd\b/gi,
  /\b4x2\b/gi,
  /\bawd\b/gi,
  /\bcab(?:ine|\.)?\s*(?:dupla|simples)\b/gi,
];

const TRIM_ACRONYMS = new Set([
  'rs', 'ss', 'ls', 'glx', 'gls', 'le', 'gt', 'gti', 'xei', 'lt', 'ltz', 'se', 'sl', 'sv',
  'tsi', 'tdi', 'hdi', 'cdi', 'vht', 'srv', 'ltd', 'xls', 'xlt', 'sw4', 'ex', 'exl', 'gli',
]);

const CAB_TYPE_RE = /\bcab(?:ine|\.)?\s*(dupla|simples)\b/i;

/** Detecta tipo de cabine no texto: "Cab. Dupla"/"Cabine Dupla" -> "dupla", "Cab. Simples" -> "simples". */
export function extractCabType(version: string): string | undefined {
  if (!version) return undefined;
  const match = version.match(CAB_TYPE_RE);
  if (!match) return undefined;
  return match[1].toLowerCase();
}

/** Detecta menção de tração no texto: "4x4"/"4wd" -> "4x4", "4x2" -> "4x2", "awd" -> "awd". */
export function extractTraction(version: string): string | undefined {
  if (!version) return undefined;
  const match = version.match(TRACTION_RE);
  if (!match) return undefined;
  const token = match[1].toLowerCase();
  if (token === '4wd') return '4x4';
  return token;
}

/**
 * Title Case locale-aware para PT-BR: normaliza acentos antes de capitalizar (evita bugs tipo
 * "FurgãO") e mantém siglas conhecidas (RS, GLX, TSI...) em uppercase em vez de "Rs"/"Glx".
 */
export function toTitleCasePtBr(text: string): string {
  return collapseSpaces(text ?? '')
    .split(' ')
    .map((word) => {
      if (!word) return word;
      const bare = word.replace(/[().]/g, '');
      if (TRIM_ACRONYMS.has(removeAccents(bare).toLowerCase())) {
        return word.toUpperCase();
      }
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Remove de version os tokens redundantes já capturados em campos estruturados (cilindrada,
 * portas, combustível, transmissão, tração) e retorna o texto residual (nome comercial/edição)
 * em Title Case PT-BR → undefined se nada sobrar.
 */
export function extractTrim(version: string): string | undefined {
  if (!version) return undefined;

  let remaining = version;
  for (const pattern of TRIM_STRIP_PATTERNS) {
    remaining = remaining.replace(pattern, ' ');
  }

  const cleaned = collapseSpaces(remaining.replace(/[()]+/g, ' ')).replace(/(?:^|\s)\.(?=\s|$)/g, '');
  if (!cleaned) return undefined;

  return toTitleCasePtBr(cleaned);
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

export function generateEngineSignature(input?: {
  displacementCc?: number;
  fuelType?: string;
}): string {
  if (!input) return '';

  const toNormalizedToken = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = String(value).toLowerCase().trim();
    return str;
  };

  const parts = [
    toNormalizedToken(input.displacementCc),
    toNormalizedToken(input.fuelType),
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
  years?: number[];
  displacementCc?: number;
  fuelType?: string;
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
  if (input.years?.length) score += 12;
  if (input.displacementCc) score += 18;
  if (input.fuelType) score += 10;
  if (input.transmission?.length) score += 6;
  if (input.bodyType) score += 4;
  if (input.platform) score += 4;
  if (input.fipe?.code) score += 4;
  if (input.aliases?.length) score += 2;
  return Math.max(0, Math.min(100, score));
}


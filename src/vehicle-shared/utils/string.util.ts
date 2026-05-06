export function removeAccents(str: string): string {
  return (str ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function collapseSpaces(str: string): string {
  return (str ?? '').replace(/\s+/g, ' ').trim();
}

export function cleanString(str: string): string {
  return collapseSpaces(removeAccents(str));
}

export function toLowerClean(str: string): string {
  return cleanString(str).toLowerCase();
}

export function toUpperClean(str: string): string {
  return cleanString(str).toUpperCase();
}

export function removePunctuation(str: string): string {
  return (str ?? '').replace(/[^\w\s.]/gi, ' ');
}

export function tokenize(str: string): string[] {
  return toLowerClean(removePunctuation(str))
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function tryParseJson(raw: string): Record<string, any> | null {
  const cleaned = (raw ?? '')
    .replace(/```json/g, '```')
    .replace(/```/g, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    const repaired = candidate
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
    try {
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

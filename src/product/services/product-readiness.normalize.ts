/**
 * Normalizes a stored `completion.completedAt` value into a valid `Date` or `null`.
 *
 * Guards against corrupted persisted values (notably `{}`, which Mongoose can
 * write when the `completion` subdocument default `{}` is applied without the
 * subschema defaults). Such a value is truthy, so a bare `?? null` lets it slip
 * through and re-grava `{}` into a `Date` path → "Cast to date failed for value {}".
 */
export function normalizeCompletedAt(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Objects (e.g. `{}`), booleans, etc. are not valid dates.
  return null;
}

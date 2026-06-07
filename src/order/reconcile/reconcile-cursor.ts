export const RECONCILE = {
  FLOOR_MS: 5 * 60 * 1000, // 5 min
  CEILING_MS: 20 * 60 * 1000, // 20 min
  BOOTSTRAP_WINDOW_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * Adaptive interval: on a clean run (no gaps found) the interval doubles up to the ceiling;
 * when a gap is found it resets to the floor so the next check happens sooner.
 */
export function nextInterval(current: number, cleanRun: boolean): number {
  if (!cleanRun) return RECONCILE.FLOOR_MS;
  return Math.min(current * 2, RECONCILE.CEILING_MS);
}

/** Highest date_last_updated among refs, or `fallback` when the delta is empty. */
export function maxCursor(refs: Array<{ date_last_updated: string }>, fallback: Date): Date {
  if (!refs.length) return fallback;
  return refs.reduce((acc, r) => {
    const d = new Date(r.date_last_updated);
    return d > acc ? d : acc;
  }, new Date(0));
}

/** Case-insensitive status comparison. */
export function isStatusDivergent(localStatus?: string, externalStatus?: string): boolean {
  return (localStatus ?? '').toLowerCase() !== (externalStatus ?? '').toLowerCase();
}

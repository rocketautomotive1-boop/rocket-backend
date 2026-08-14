export const QUESTION_RECONCILE = {
  FLOOR_MS: 5 * 60 * 1000,
  CEILING_MS: 20 * 60 * 1000,
  BOOTSTRAP_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
};

export function nextInterval(current: number, cleanRun: boolean): number {
  if (!cleanRun) return QUESTION_RECONCILE.FLOOR_MS;
  return Math.min(current * 2, QUESTION_RECONCILE.CEILING_MS);
}

export function maxQuestionCursor(refs: Array<{ date_created: string }>, fallback: Date): Date {
  if (!refs.length) return fallback;
  return refs.reduce((acc, r) => {
    const d = new Date(r.date_created);
    return d > acc ? d : acc;
  }, new Date(0));
}

export function isStatusDivergent(local?: string, external?: string): boolean {
  return (local ?? '').toLowerCase() !== (external ?? '').toLowerCase();
}

import { QUESTION_RECONCILE, nextInterval, maxQuestionCursor, isStatusDivergent } from './question-reconcile-cursor';

describe('question-reconcile-cursor', () => {
  it('nextInterval doubles on clean run up to ceiling', () => {
    expect(nextInterval(QUESTION_RECONCILE.FLOOR_MS, true)).toBe(QUESTION_RECONCILE.FLOOR_MS * 2);
    expect(nextInterval(QUESTION_RECONCILE.CEILING_MS, true)).toBe(QUESTION_RECONCILE.CEILING_MS);
  });

  it('nextInterval resets to floor on a gap', () => {
    expect(nextInterval(QUESTION_RECONCILE.CEILING_MS, false)).toBe(QUESTION_RECONCILE.FLOOR_MS);
  });

  it('maxQuestionCursor returns fallback for empty delta', () => {
    const fb = new Date('2026-01-01T00:00:00Z');
    expect(maxQuestionCursor([], fb)).toBe(fb);
  });

  it('maxQuestionCursor returns the newest date_created', () => {
    const fb = new Date('2026-01-01T00:00:00Z');
    const out = maxQuestionCursor(
      [{ date_created: '2026-06-01T00:00:00Z' }, { date_created: '2026-06-10T00:00:00Z' }], fb,
    );
    expect(out.toISOString()).toBe('2026-06-10T00:00:00.000Z');
  });

  it('isStatusDivergent is case-insensitive', () => {
    expect(isStatusDivergent('UNANSWERED', 'unanswered')).toBe(false);
    expect(isStatusDivergent('UNANSWERED', 'ANSWERED')).toBe(true);
  });
});

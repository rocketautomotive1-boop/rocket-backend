export type QuestionIngestSource = 'webhook' | 'reconcile' | 'manual';

export interface ExistingQuestionView {
  status?: string;
  product?: unknown | null;
  notified?: boolean;
}

export interface IncomingQuestionView {
  status?: string;
  hasAnswer?: boolean;
}

export type QuestionAction =
  | { kind: 'CREATE' }
  | { kind: 'UPDATE_ANSWER' }
  | { kind: 'LINK_PRODUCT' }
  | { kind: 'SKIP' }
  | { kind: 'RECOVER_NOTIFICATION' };

const uc = (s?: string) => (s ?? '').toUpperCase();

export function decideQuestionAction(
  existing: ExistingQuestionView | null,
  incoming: IncomingQuestionView,
): QuestionAction {
  if (!existing) return { kind: 'CREATE' };

  const localStatus = uc(existing.status);
  const inStatus = uc(incoming.status);

  if (localStatus === 'UNANSWERED' && (incoming.hasAnswer || inStatus === 'ANSWERED')) {
    return { kind: 'UPDATE_ANSWER' };
  }

  if (!existing.product) {
    return { kind: 'LINK_PRODUCT' };
  }

  if (localStatus === 'UNANSWERED' && existing.notified === false) {
    return { kind: 'RECOVER_NOTIFICATION' };
  }

  return { kind: 'SKIP' };
}

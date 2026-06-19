import { decideQuestionAction } from './question-ingest.decision';

describe('decideQuestionAction', () => {
  it('no existing → CREATE', () => {
    expect(decideQuestionAction(null, { status: 'UNANSWERED' })).toEqual({ kind: 'CREATE' });
  });

  it('incoming answered while local unanswered → UPDATE_ANSWER', () => {
    expect(
      decideQuestionAction(
        { status: 'UNANSWERED', product: 'p', notified: true },
        { status: 'ANSWERED', hasAnswer: true },
      ),
    ).toEqual({ kind: 'UPDATE_ANSWER' });
  });

  it('unchanged but product missing → LINK_PRODUCT', () => {
    expect(
      decideQuestionAction(
        { status: 'UNANSWERED', product: null, notified: true },
        { status: 'UNANSWERED' },
      ),
    ).toEqual({ kind: 'LINK_PRODUCT' });
  });

  it('unchanged, product present, never notified, still unanswered → RECOVER_NOTIFICATION', () => {
    expect(
      decideQuestionAction(
        { status: 'UNANSWERED', product: 'p', notified: false },
        { status: 'UNANSWERED' },
      ),
    ).toEqual({ kind: 'RECOVER_NOTIFICATION' });
  });

  it('fully settled → SKIP', () => {
    expect(
      decideQuestionAction(
        { status: 'ANSWERED', product: 'p', notified: true },
        { status: 'ANSWERED', hasAnswer: true },
      ),
    ).toEqual({ kind: 'SKIP' });
  });
});

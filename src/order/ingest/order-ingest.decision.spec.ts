import { decideIngestAction, IngestAction } from './order-ingest.decision';

const CONFIRMED = 'paid';

describe('decideIngestAction', () => {
  it('CREATE_DEDUCT when no existing order and status is confirmed', () => {
    const a = decideIngestAction(null, { status: CONFIRMED }, 'webhook');
    expect(a.kind).toBe<IngestAction['kind']>('CREATE_DEDUCT');
  });

  it('CREATE_PENDING when no existing order and status not confirmed', () => {
    const a = decideIngestAction(null, { status: 'payment_required' }, 'webhook');
    expect(a.kind).toBe('CREATE_PENDING');
  });

  it('CANCEL when existing was deducted and incoming is cancelled', () => {
    const a = decideIngestAction(
      { logisticsStatus: 'deducted', status: 'paid', notificationStatus: { whatsapp: { status: 'sent' } } },
      { status: 'cancelled' },
      'webhook',
    );
    expect(a.kind).toBe('CANCEL');
  });

  it('UPDATE_STATUS when deducted and status changed (non-cancel)', () => {
    const a = decideIngestAction(
      { logisticsStatus: 'deducted', status: 'paid', notificationStatus: { whatsapp: { status: 'sent' } } },
      { status: 'shipped' },
      'webhook',
    );
    expect(a.kind).toBe('UPDATE_STATUS');
  });

  it('SKIP when deducted, same status, notification already sent', () => {
    const a = decideIngestAction(
      { logisticsStatus: 'deducted', status: 'paid', notificationStatus: { whatsapp: { status: 'sent' } } },
      { status: 'paid' },
      'webhook',
    );
    expect(a.kind).toBe('SKIP');
  });

  it('RECOVER_NOTIFICATION when deducted, same status, notification missing', () => {
    const a = decideIngestAction(
      { logisticsStatus: 'deducted', status: 'paid', notificationStatus: {} },
      { status: 'paid' },
      'reconcile',
    );
    expect(a.kind).toBe('RECOVER_NOTIFICATION');
  });

  it('UPSERT_DEDUCT when existing not yet deducted and incoming confirmed', () => {
    const a = decideIngestAction(
      { logisticsStatus: 'pending', status: 'payment_required' },
      { status: CONFIRMED },
      'sync',
    );
    expect(a.kind).toBe('UPSERT_DEDUCT');
  });

  it('CREATE_PENDING when existing not deducted and incoming still not confirmed', () => {
    const a = decideIngestAction(
      { logisticsStatus: 'pending', status: 'payment_required' },
      { status: 'payment_required' },
      'sync',
    );
    expect(a.kind).toBe('CREATE_PENDING');
  });
});

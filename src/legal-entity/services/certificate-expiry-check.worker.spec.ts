import { EventEmitter2 } from '@nestjs/event-emitter';
import { CertificateExpiryCheckWorker } from './certificate-expiry-check.worker';
import { NOTIFICATION_EVENTS } from '../../notifications/events/notification.events';

describe('CertificateExpiryCheckWorker', () => {
  let worker: CertificateExpiryCheckWorker;
  let legalEntityModel: { find: jest.Mock };
  let eventEmitter: EventEmitter2;

  const daysFromNow = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
  };

  beforeEach(() => {
    eventEmitter = new EventEmitter2();
  });

  function setup(entities: any[]) {
    legalEntityModel = { find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(entities) }) };
    worker = new CertificateExpiryCheckWorker(legalEntityModel as any, eventEmitter);
  }

  it('notifica quando faltam exatamente 30, 15 ou 7 dias', async () => {
    setup([
      { _id: '1', companyName: 'Rocket', cnpj: '00000000000191', certificateValidUntil: daysFromNow(30) },
    ]);
    const listener = jest.fn();
    eventEmitter.on(NOTIFICATION_EVENTS.REQUESTED, listener);

    await worker.checkExpiringCertificates();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: 'fiscal.certificate.expiring',
      severity: 'warning',
      data: { legalEntityId: '1', daysRemaining: 30 },
    });
  });

  it('não notifica em dias fora da lista de aviso (ex.: 20 dias)', async () => {
    setup([
      { _id: '1', companyName: 'Rocket', cnpj: '00000000000191', certificateValidUntil: daysFromNow(20) },
    ]);
    const listener = jest.fn();
    eventEmitter.on(NOTIFICATION_EVENTS.REQUESTED, listener);

    await worker.checkExpiringCertificates();

    expect(listener).not.toHaveBeenCalled();
  });

  it('usa severidade "error" quando faltam 7 dias ou menos', async () => {
    setup([
      { _id: '1', companyName: 'Rocket', cnpj: '00000000000191', certificateValidUntil: daysFromNow(7) },
    ]);
    const listener = jest.fn();
    eventEmitter.on(NOTIFICATION_EVENTS.REQUESTED, listener);

    await worker.checkExpiringCertificates();

    expect(listener.mock.calls[0][0].severity).toBe('error');
  });
});

import { WebhookMetricsService } from './webhook-metrics.service';
describe('WebhookMetricsService', () => {
  it('conta received, rejected e dead por chave', () => {
    const sut = new WebhookMetricsService();
    sut.incReceived('mercadolivre','order'); sut.incReceived('mercadolivre','order');
    sut.incRejected('shopee','bad_signature'); sut.incDead('amazon','order');
    const snap = sut.snapshot();
    expect(snap.received['mercadolivre:order']).toBe(2);
    expect(snap.rejected['shopee:bad_signature']).toBe(1);
    expect(snap.dead['amazon:order']).toBe(1);
  });
});

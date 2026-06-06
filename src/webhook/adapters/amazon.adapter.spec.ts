import { AmazonAdapter } from './amazon.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any):WebhookContext => ({ marketplace:'amazon', topic, headers:{}, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('AmazonAdapter.parse', () => {
  const sut = new AmazonAdapter();
  it('order from Message JSON', () => { const n = sut.parse(ctx('order-notification',{ Message: JSON.stringify({ AmazonOrderId:'AMZ-1' }) })); expect(n.kind).toBe('order'); expect(n.externalId).toBe('AMZ-1'); expect(n.eventId).toBe('amazon:order:AMZ-1'); });
  it('order fallback top-level AmazonOrderId', () => { const n = sut.parse(ctx('order-notification',{ AmazonOrderId:'AMZ-2' })); expect(n.kind).toBe('order'); expect(n.externalId).toBe('AMZ-2'); });
  it('SubscriptionConfirmation → ignore', () => { const n = sut.parse(ctx('order-notification',{ Type:'SubscriptionConfirmation', SubscribeURL:'http://x' })); expect(n.kind).toBe('ignore'); expect(n.eventId).toBe('amazon:subscription-confirmation'); });
  it('unrelated topic → ignore', () => { expect(sut.parse(ctx('item-notification',{})).kind).toBe('ignore'); });
  it('confirmSubscription exists', () => { expect(typeof sut.confirmSubscription).toBe('function'); });
  it('scheme aws-sns', () => { expect(sut.signatureScheme.type).toBe('aws-sns'); });
});

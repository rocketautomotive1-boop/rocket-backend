import * as crypto from 'crypto';
import { MagaluAdapter } from './magalu.adapter';
import { WebhookContext } from './webhook-adapter.interface';
const ctx = (topic:string,payload:any,headers:Record<string,string> = {}):WebhookContext => ({ marketplace:'magalu', topic, headers, payload, rawBody:Buffer.from(JSON.stringify(payload)) });
describe('MagaluAdapter.parse', () => {
  const sut = new MagaluAdapter();
  it('order data.id', () => { const n = sut.parse(ctx('orders',{data:{id:'M1'}})); expect(n.kind).toBe('order'); expect(n.externalId).toBe('M1'); expect(n.eventId).toBe('magalu:orders:M1'); });
  it('order fallback order_id', () => { expect(sut.parse(ctx('orders',{order_id:'M2'})).externalId).toBe('M2'); });
  it('unrelated → ignore', () => { expect(sut.parse(ctx('items',{})).kind).toBe('ignore'); });
  it('scheme hmac', () => { expect(sut.signatureScheme.type).toBe('hmac-sha256'); });

  it('scheme usa header x-signature-256 (não x-magalu-signature)', () => {
    const scheme = sut.signatureScheme as Extract<typeof sut.signatureScheme, { type: 'hmac-sha256' }>;
    expect(scheme.header).toBe('x-signature-256');
  });

  it('scheme baseString monta {timestamp}.{body}', () => {
    const scheme = sut.signatureScheme as Extract<typeof sut.signatureScheme, { type: 'hmac-sha256' }>;
    const c = ctx('orders', { data: { id: 'M1' } }, { 'x-timestamp': '1234567890' });
    expect((scheme.baseString as (c: WebhookContext) => string)(c)).toBe(`1234567890.${c.rawBody!.toString('utf8')}`);
  });

  it('scheme secretKey varia por tópico (cada subscription tem secret próprio)', () => {
    const scheme = sut.signatureScheme as Extract<typeof sut.signatureScheme, { type: 'hmac-sha256' }>;
    expect(typeof scheme.secretKey).toBe('function');
    const resolveKey = scheme.secretKey as (c: WebhookContext) => string;
    expect(resolveKey(ctx('portfolios_sku', {}))).toBe('webhookSecret:portfolios_sku');
    expect(resolveKey(ctx('portfolios_price', {}))).toBe('webhookSecret:portfolios_price');
    expect(resolveKey(ctx('portfolios_stock', {}))).toBe('webhookSecret:portfolios_stock');
  });

  it('portfolios_sku com data.params.sku → listing_status', () => {
    const payload = { data: { status: 'published', params: { sku: 'prod123' }, resource: '/seller/v1/portfolios/skus/prod123' } };
    const n = sut.parse(ctx('portfolios_sku', payload));
    expect(n.kind).toBe('listing_status');
    expect(n.externalId).toBe('prod123');
    expect(n.eventId).toBe('magalu:portfolios_sku:prod123:published');
    expect(n.resource).toBe('/seller/v1/portfolios/skus/prod123');
  });

  it('portfolios_price → listing_status', () => {
    const n = sut.parse(ctx('portfolios_price', { data: { status: 'updated', params: { sku: 'prod123' } } }));
    expect(n.kind).toBe('listing_status');
  });

  it('portfolios_stock → listing_status', () => {
    const n = sut.parse(ctx('portfolios_stock', { data: { status: 'updated', params: { sku: 'prod123' } } }));
    expect(n.kind).toBe('listing_status');
  });

  it('portfolios_sku sem sku → ignore', () => {
    const n = sut.parse(ctx('portfolios_sku', { data: { status: 'published' } }));
    expect(n.kind).toBe('ignore');
  });
});

describe('MagaluAdapter signature format (integração com SignatureVerifier)', () => {
  it('assinatura real do Magalu (sha256=<hex> sobre {timestamp}.{body}) bate no formato esperado', () => {
    const secret = 'whsec_test123';
    const timestamp = '1700000000';
    const body = JSON.stringify({ data: { status: 'published', params: { sku: 'x' } } });
    const signedPayload = `${timestamp}.${body}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `sha256=${expected}`;
    // O que o MagaluAdapter.signatureScheme.baseString produziria:
    const sut = new MagaluAdapter();
    const scheme = sut.signatureScheme as Extract<typeof sut.signatureScheme, { type: 'hmac-sha256' }>;
    const c: WebhookContext = { marketplace: 'magalu', topic: 'portfolios_sku', headers: { 'x-timestamp': timestamp }, payload: JSON.parse(body), rawBody: Buffer.from(body) };
    const base = (scheme.baseString as (c: WebhookContext) => string)(c);
    const recomputed = crypto.createHmac('sha256', secret).update(base).digest('hex');
    expect(`sha256=${recomputed}`).toBe(header);
  });
});

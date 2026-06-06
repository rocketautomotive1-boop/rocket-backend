import * as crypto from 'crypto';
import { SignatureVerifier } from './signature-verifier.service';
import { WebhookContext } from '../adapters/webhook-adapter.interface';

const makeCtx = (over: Partial<WebhookContext> = {}): WebhookContext => ({
  marketplace: 'mercadolivre',
  topic: 'orders_v2',
  headers: {},
  rawBody: Buffer.from('{"a":1}'),
  payload: { a: 1 },
  ...over,
});

const sign = (secret: string, body: string) =>
  crypto.createHmac('sha256', secret).update(body).digest('hex');

describe('SignatureVerifier (hmac-sha256)', () => {
  const makeSut = (secret?: string) => {
    const credentials = { get: jest.fn().mockResolvedValue(secret) };
    return { sut: new SignatureVerifier(credentials as any), credentials };
  };
  const scheme = {
    type: 'hmac-sha256' as const,
    header: 'x-signature',
    secretKey: 'webhookSecret',
    baseString: 'rawBody' as const,
  };

  it('aceita assinatura válida', async () => {
    const { sut } = makeSut('s3cr3t');
    const body = '{"a":1}';
    const ctx = makeCtx({ rawBody: Buffer.from(body), headers: { 'x-signature': sign('s3cr3t', body) } });
    await expect(sut.verify(scheme, ctx)).resolves.toBe(true);
  });

  it('rejeita assinatura inválida (mesmo tamanho)', async () => {
    const { sut } = makeSut('s3cr3t');
    const body = '{"a":1}';
    const ctx = makeCtx({ rawBody: Buffer.from(body), headers: { 'x-signature': sign('outro', body) } });
    await expect(sut.verify(scheme, ctx)).resolves.toBe(false);
  });

  it('rejeita header de tamanho diferente sem lançar', async () => {
    const { sut } = makeSut('s3cr3t');
    const ctx = makeCtx({ headers: { 'x-signature': 'curto' } });
    await expect(sut.verify(scheme, ctx)).resolves.toBe(false);
  });

  it('FAIL-CLOSED: rejeita quando o segredo não está configurado', async () => {
    const { sut } = makeSut(undefined);
    const ctx = makeCtx({ headers: { 'x-signature': 'qualquer' } });
    await expect(sut.verify(scheme, ctx)).resolves.toBe(false);
  });

  it('rejeita quando o header está ausente', async () => {
    const { sut } = makeSut('s3cr3t');
    await expect(sut.verify(scheme, makeCtx())).resolves.toBe(false);
  });

  it('scheme none sempre aceita', async () => {
    const { sut } = makeSut(undefined);
    await expect(sut.verify({ type: 'none' }, makeCtx())).resolves.toBe(true);
  });

  it('baseString custom é usado no HMAC', async () => {
    const { sut } = makeSut('k');
    const ctx = makeCtx({ payload: { partner_id: 7 }, rawBody: Buffer.from('BODY'), headers: {} });
    const expected = crypto.createHmac('sha256','k').update('7BODY').digest('hex');
    const customScheme = { type: 'hmac-sha256' as const, header: 'x-sig', secretKey: 'partnerKey',
      baseString: (c: WebhookContext) => `${c.payload?.partner_id ?? ''}${c.rawBody?.toString('utf8') ?? ''}` };
    const ok = await sut.verify(customScheme, makeCtx({ payload: { partner_id: 7 }, rawBody: Buffer.from('BODY'), headers: { 'x-sig': expected } }));
    expect(ok).toBe(true);
  });
});

describe('SignatureVerifier (aws-sns)', () => {
  const makeSut = () => new SignatureVerifier({ get: jest.fn() } as any);

  it('rejeita mensagem SNS sem assinatura', async () => {
    const sut = makeSut();
    const ctx = makeCtx({ marketplace: 'amazon', payload: { Type: 'Notification' } });
    await expect(sut.verify({ type: 'aws-sns' }, ctx)).resolves.toBe(false);
  });

  it('rejeita host de SigningCertURL fora da amazonaws', async () => {
    const sut = makeSut();
    const ctx = makeCtx({ marketplace: 'amazon', payload: { Type: 'Notification', Signature: 'x', SigningCertURL: 'https://evil.com/c.pem' } });
    await expect(sut.verify({ type: 'aws-sns' }, ctx)).resolves.toBe(false);
  });

  it('aceita SNS com assinatura válida (cert de teste injetado)', async () => {
    const sut = makeSut();
    const { certPem, payload } = buildSignedSnsFixture();
    (sut as any).fetchCertificate = jest.fn().mockResolvedValue(certPem);
    const ctx = makeCtx({ marketplace: 'amazon', payload });
    await expect(sut.verify({ type: 'aws-sns' }, ctx)).resolves.toBe(true);
  });
});

function buildSignedSnsFixture() {
  const { generateKeyPairSync, createSign } = require('crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const payload: any = {
    Type: 'Notification', MessageId: 'm1', TopicArn: 'arn:test',
    Message: '{"AmazonOrderId":"123"}', Timestamp: '2026-06-06T00:00:00.000Z',
    SignatureVersion: '1', SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem', Subject: 'x',
  };
  const canonical =
    `Message\n${payload.Message}\n` + `MessageId\n${payload.MessageId}\n` +
    `Subject\n${payload.Subject}\n` + `Timestamp\n${payload.Timestamp}\n` +
    `TopicArn\n${payload.TopicArn}\n` + `Type\n${payload.Type}\n`;
  const signer = createSign('RSA-SHA1');
  signer.update(canonical, 'utf8');
  payload.Signature = signer.sign(privateKey, 'base64');
  return { certPem, payload };
}

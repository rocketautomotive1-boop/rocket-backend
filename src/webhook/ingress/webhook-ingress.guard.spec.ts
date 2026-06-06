import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { WebhookIngressGuard } from './webhook-ingress.guard';
const makeCtx = (params:any, payload:any={}, headers:any={}) => ({
  switchToHttp: () => ({ getRequest: () => ({ params, body: payload, headers, rawBody: Buffer.from(JSON.stringify(payload)) }) }),
} as any);
describe('WebhookIngressGuard', () => {
  const adapter = { marketplace:'mercadolivre', signatureScheme:{type:'none'}, parse: jest.fn() };
  const makeSut = (has=true, verifyResult=true) => {
    const registry = { get: jest.fn().mockReturnValue(has ? adapter : undefined) };
    const verifier = { verify: jest.fn().mockResolvedValue(verifyResult) };
    const metrics = { incRejected: jest.fn() };
    return { sut: new WebhookIngressGuard(registry as any, verifier as any, metrics as any), registry, verifier, metrics };
  };
  it('marketplace desconhecido → NotFound', async () => {
    const { sut } = makeSut(false);
    await expect(sut.canActivate(makeCtx({ marketplace:'xpto', topic:'t' }))).rejects.toBeInstanceOf(NotFoundException);
  });
  it('assinatura inválida → Unauthorized + métrica', async () => {
    const { sut, metrics } = makeSut(true, false);
    await expect(sut.canActivate(makeCtx({ marketplace:'mercadolivre', topic:'t' }))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(metrics.incRejected).toHaveBeenCalledWith('mercadolivre','bad_signature');
  });
  it('ok → true e anexa adapter+context no request', async () => {
    const { sut } = makeSut(true, true);
    const req:any = { params:{ marketplace:'mercadolivre', topic:'t' }, body:{}, headers:{}, rawBody: Buffer.from('{}') };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    await expect(sut.canActivate(context)).resolves.toBe(true);
    expect(req.webhookAdapter).toBe(adapter);
    expect(req.webhookContext.marketplace).toBe('mercadolivre');
  });
});

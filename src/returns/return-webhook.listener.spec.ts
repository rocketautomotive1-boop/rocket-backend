import { ReturnWebhookListener } from './return-webhook.listener';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';

const mlMkt = { _id: 'MKT1', name: 'Mercado Livre' };

const DEFAULT_CLAIM = {
  id: '136', type: 'returns', stage: 'claim', status: 'opened', reasonId: null,
  orderId: '2000', buyerName: 'João', firstItemTitle: 'Rádio', firstQty: 1,
  extraItemsCount: 0, totalAmount: 800, soldAt: '2026-06-22T16:00:00.000Z',
};

function makeSut(opts?: { claim?: any }) {
  const registry = { findByTag: jest.fn().mockResolvedValue(mlMkt) };
  const broker = {
    resolveAccountByExternalUserId: jest.fn().mockResolvedValue({ accountId: 'ACC_A' }),
    ensureValidTokenByAccount: jest.fn().mockResolvedValue({ accessToken: 'tok-A' }),
    ensureValidToken: jest.fn().mockResolvedValue({ accessToken: 'tok-default' }),
  };
  const claim = opts && 'claim' in opts ? opts.claim : DEFAULT_CLAIM;
  const claimsClient = {
    getClaimSummary: jest.fn().mockResolvedValue(claim),
  };
  const emitter = { emit: jest.fn() };
  const sut = new ReturnWebhookListener(
    registry as any, broker as any, claimsClient as any, emitter as any,
  );
  return { sut, registry, broker, claimsClient, emitter };
}

const cmd = (over?: any) => ({
  marketplace: 'mercadolivre', externalId: '136', externalUserId: '9',
  resource: '/post-purchase/v1/claims/136', receivedAt: new Date(), source: 'webhook' as const,
  ...over,
});

describe('ReturnWebhookListener.onReturn', () => {
  it('resolve a conta pelo user_id e busca o claim com o token dela', async () => {
    const { sut, broker, claimsClient } = makeSut();
    await sut.onReturn(cmd());
    expect(broker.resolveAccountByExternalUserId).toHaveBeenCalledWith('MKT1', '9');
    expect(broker.ensureValidTokenByAccount).toHaveBeenCalledWith('MKT1', 'ACC_A');
    expect(claimsClient.getClaimSummary).toHaveBeenCalledWith('136', 'tok-A');
  });

  it('emite NotificationRequested com app + whatsapp e body formatado', async () => {
    const { sut, emitter } = makeSut();
    await sut.onReturn(cmd());
    expect(emitter.emit).toHaveBeenCalledWith(NOTIFICATION_EVENTS.REQUESTED, expect.objectContaining({
      type: 'order.return',
      aggregateType: 'order',
      aggregateId: '2000',
      channels: ['persist', 'push', 'websocket', 'whatsapp'],
      deduplicationKey: 'order.return:MKT1:136',
    }));
    const payload = emitter.emit.mock.calls[0][1];
    expect(payload.body).toContain('DEVOLUÇÃO / RECLAMAÇÃO');
    expect(payload.body).toContain('*Rádio*');
    expect(payload.data).toMatchObject({ claimId: '136', externalId: '2000', actionRoute: '/(drawer)/orders' });
  });

  it('usa o token default quando não há user_id', async () => {
    const { sut, broker, claimsClient } = makeSut();
    await sut.onReturn(cmd({ externalUserId: null }));
    expect(broker.resolveAccountByExternalUserId).not.toHaveBeenCalled();
    expect(broker.ensureValidToken).toHaveBeenCalledWith('MKT1');
    expect(claimsClient.getClaimSummary).toHaveBeenCalledWith('136', 'tok-default');
  });

  it('ignora marketplace != mercadolivre', async () => {
    const { sut, emitter, registry } = makeSut();
    await sut.onReturn(cmd({ marketplace: 'shopee' }));
    expect(registry.findByTag).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('não emite quando o claim não é encontrado', async () => {
    const { sut, emitter } = makeSut({ claim: null });
    await sut.onReturn(cmd());
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

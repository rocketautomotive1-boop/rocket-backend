import { WebhookInboxService } from './webhook-inbox.service';

describe('WebhookInboxService', () => {
  const makeSut = (env: Record<string, any> = {}) => {
    const webhookInboxModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };
    const configService = {
      get: jest.fn((key: string, fallback?: any) => (key in env ? env[key] : fallback)),
    };

    const service = new WebhookInboxService(
      webhookInboxModel as any,
      configService as any,
    );

    return { service, webhookInboxModel };
  };

  it('persiste novo webhook na inbox', async () => {
    const { service, webhookInboxModel } = makeSut();

    webhookInboxModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    webhookInboxModel.create.mockResolvedValue({ _id: 'inbox-1' });

    const result = await service.store({
      marketplace: 'mercadolivre',
      topic: 'orders_v2',
      payload: { resource: '/orders/123' },
    });

    expect(result.isNew).toBe(true);
    expect(result.record._id).toBe('inbox-1');
    expect(webhookInboxModel.create).toHaveBeenCalledTimes(1);
  });

  it('não duplica quando dedupeKey já existe', async () => {
    const { service, webhookInboxModel } = makeSut();
    const existing = { _id: 'inbox-existing' };

    webhookInboxModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

    const result = await service.store({
      marketplace: 'mercadolivre',
      topic: 'orders_v2',
      payload: { resource: '/orders/123' },
    });

    expect(result.isNew).toBe(false);
    expect(result.record._id).toBe('inbox-existing');
    expect(webhookInboxModel.create).not.toHaveBeenCalled();
  });

  it('habilita inbox apenas para marketplaces configurados', () => {
    const { service } = makeSut({
      WEBHOOK_INBOX_ENABLED: 'true',
      WEBHOOK_INBOX_MARKETPLACES: 'mercadolivre,shopee',
    });

    expect(service.isEnabledForMarketplace('mercadolivre')).toBe(true);
    expect(service.isEnabledForMarketplace('amazon')).toBe(false);
  });
});

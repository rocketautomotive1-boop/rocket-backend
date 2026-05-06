import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  const makeSut = (inboxEnabled = true) => {
    const eventEmitter = { emit: jest.fn() };
    const mercadoLivreWebhookService = {
      processWebhook: jest.fn().mockResolvedValue({ success: true }),
    };
    const webhookInboxService = {
      isEnabledForMarketplace: jest.fn().mockReturnValue(inboxEnabled),
      store: jest.fn().mockResolvedValue({ record: { _id: 'inbox-1' }, isNew: true }),
    };

    const service = new WebhookService(
      {} as any,
      { get: jest.fn() } as any,
      eventEmitter as any,
      mercadoLivreWebhookService as any,
      { processWebhook: jest.fn() } as any,
      { processWebhook: jest.fn() } as any,
      { processWebhook: jest.fn() } as any,
      { processWebhook: jest.fn() } as any,
      { processWebhook: jest.fn() } as any,
      { processWebhook: jest.fn() } as any,
      { processWebhook: jest.fn() } as any,
      { processWebhook: jest.fn() } as any,
      { processWebhook: jest.fn() } as any,
      webhookInboxService as any,
    );

    return { service, eventEmitter, webhookInboxService, mercadoLivreWebhookService };
  };

  it('persiste webhook ML de pedido na inbox e não usa evento em memória', async () => {
    const { service, eventEmitter, webhookInboxService } = makeSut(true);

    await service.processMercadoLivreWebhook('orders_v2', { resource: '/orders/123' }, 'sig');

    expect(webhookInboxService.store).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).not.toHaveBeenCalledWith(
      'webhook.received',
      expect.anything(),
    );
  });

  it('mantém fallback para eventEmitter quando inbox não está habilitada', async () => {
    const { service, eventEmitter, webhookInboxService } = makeSut(false);

    await service.processMercadoLivreWebhook('orders_v2', { resource: '/orders/123' }, 'sig');

    expect(webhookInboxService.store).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith('webhook.received', {
      marketplace: 'mercadolivre',
      topic: 'orders_v2',
      payload: { resource: '/orders/123' },
    });
  });
});

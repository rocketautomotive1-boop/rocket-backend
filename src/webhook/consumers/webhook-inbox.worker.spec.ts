import { WebhookInboxWorker } from './webhook-inbox.worker';

describe('WebhookInboxWorker', () => {
  const makeSut = (dispatcherThrows = false) => {
    const webhookInboxModel = {
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findByIdAndUpdate: jest.fn().mockResolvedValue(undefined),
    };
    const webhookDispatcher = {
      dispatchWebhookEvent: dispatcherThrows
        ? jest.fn().mockRejectedValue(new Error('boom'))
        : jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn((key: string, fallback?: any) => {
        const map: Record<string, any> = {
          WEBHOOK_INBOX_ENABLED: 'true',
          WEBHOOK_INBOX_BATCH_SIZE: 10,
          WEBHOOK_INBOX_MAX_ATTEMPTS: 8,
          WEBHOOK_INBOX_RETRY_BASE_MS: 30000,
        };
        return key in map ? map[key] : fallback;
      }),
    };

    const worker = new WebhookInboxWorker(
      webhookInboxModel as any,
      webhookDispatcher as any,
      configService as any,
    );

    return { worker, webhookInboxModel, webhookDispatcher };
  };

  it('marca webhook como done quando processamento dá certo', async () => {
    const { worker, webhookInboxModel, webhookDispatcher } = makeSut(false);
    const pending = {
      _id: 'inbox-1',
      marketplace: 'mercadolivre',
      topic: 'orders_v2',
      payload: { resource: '/orders/1' },
      attempts: 0,
      maxAttempts: 8,
    };

    webhookInboxModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([pending]),
    });
    webhookInboxModel.findOneAndUpdate.mockResolvedValue(pending);

    await worker.processPending();

    expect(webhookDispatcher.dispatchWebhookEvent).toHaveBeenCalledTimes(1);
    expect(webhookInboxModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'inbox-1',
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('faz retry com pending quando ocorre erro no processamento', async () => {
    const { worker, webhookInboxModel } = makeSut(true);
    const pending = {
      _id: 'inbox-2',
      marketplace: 'mercadolivre',
      topic: 'orders_v2',
      payload: { resource: '/orders/2' },
      attempts: 0,
      maxAttempts: 8,
    };

    webhookInboxModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([pending]),
    });
    webhookInboxModel.findOneAndUpdate.mockResolvedValue(pending);

    await worker.processPending();

    expect(webhookInboxModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'inbox-2',
      expect.objectContaining({
        status: 'pending',
        attempts: 1,
      }),
    );
  });
});

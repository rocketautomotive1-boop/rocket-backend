import { OrderEventsListener } from './order-events.listener';

describe('OrderEventsListener', () => {
  const baseEvent = {
    orderId: 'order-1',
    externalId: '200001',
    marketplaceId: 'mkt-1',
    marketplaceName: 'Mercado Livre',
    items: [{ productId: 'prod-1', quantity: 1, unitPrice: 100, sku: 'SKU-1' }],
    totalAmount: 100,
    triggeredBy: 'sync' as const,
  };

  const makeSut = () => {
    const syncQueueService = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const sut = new OrderEventsListener(
      {} as any,
      {} as any,
      syncQueueService as any,
    );

    return { sut, syncQueueService };
  };

  it('enfileira sempre para source=sync quando ha produto afetado', async () => {
    const { sut, syncQueueService } = makeSut();

    await sut.handleOrderProcessedEvent(baseEvent as any);

    expect(syncQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(syncQueueService.enqueue).toHaveBeenCalledWith({
      productId: 'prod-1',
      reason: 'stock_deduction',
    });
  });

  it('enfileira sempre para source=webhook quando ha produto afetado', async () => {
    const { sut, syncQueueService } = makeSut();

    await sut.handleOrderProcessedEvent({
      ...baseEvent,
      triggeredBy: 'webhook',
    } as any);

    expect(syncQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(syncQueueService.enqueue).toHaveBeenCalledWith({
      productId: 'prod-1',
      reason: 'stock_deduction',
    });
  });

  it('nao enfileira publicacao para source=retry', async () => {
    const { sut, syncQueueService } = makeSut();

    await sut.handleOrderProcessedEvent({
      ...baseEvent,
      triggeredBy: 'retry',
    } as any);

    expect(syncQueueService.enqueue).not.toHaveBeenCalled();
  });
});

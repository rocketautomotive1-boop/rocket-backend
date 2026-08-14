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
    // Constructor order: (productService, stockLedger)
    // orchestratorPublisher removed — outbox relay owns sync enqueue now
    const sut = new OrderEventsListener(
      {} as any,
      {} as any,
    );

    return { sut };
  };

  it('handleOrderProcessedEvent NÃO publica sync (outbox-na-TX assume)', async () => {
    const { sut } = makeSut();
    await sut.handleOrderProcessedEvent({
      externalId: 'E1', marketplaceName: 'ML', items: [{ productId: 'P1', quantity: 1 }], totalAmount: 10, triggeredBy: 'webhook',
    } as any);
    // No orchestratorPublisher to assert on — if the source still calls it, it will throw (undefined).
    // The test simply must not throw, confirming the publish path is gone.
  });

  it('nao enfileira publicacao para source=retry', async () => {
    const { sut } = makeSut();

    // Should not throw even though orchestratorPublisher is absent
    await expect(
      sut.handleOrderProcessedEvent({
        ...baseEvent,
        triggeredBy: 'retry',
      } as any),
    ).resolves.toBeUndefined();
  });

  it('ignora evento malformado (sem items)', async () => {
    const { sut } = makeSut();

    await expect(
      sut.handleOrderProcessedEvent(null as any),
    ).resolves.toBeUndefined();
  });
});

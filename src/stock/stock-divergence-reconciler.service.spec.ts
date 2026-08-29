import { EventEmitter2 } from '@nestjs/event-emitter';
import { StockDivergenceReconcilerService } from './stock-divergence-reconciler.service';
import { NOTIFICATION_EVENTS } from '../notifications/events/notification.events';
import { StockMovementType } from '../stock-shared/movement-type';

describe('StockDivergenceReconcilerService', () => {
  let service: StockDivergenceReconcilerService;
  let eventEmitter: EventEmitter2;

  const leanFind = (docs: any[]) => ({ find: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(docs) }) }) });

  function setup(movements: any[], balances: any[]) {
    eventEmitter = new EventEmitter2();
    service = new StockDivergenceReconcilerService(
      leanFind(movements) as any,
      leanFind(balances) as any,
      eventEmitter,
    );
  }

  it('sem divergência: não emite notificação', async () => {
    setup(
      [{ storeListingId: 's1', condition: 'new', type: StockMovementType.INBOUND, quantity: 5 }],
      [{ storeListingId: 's1', condition: 'new', onHand: 5 }],
    );
    const listener = jest.fn();
    eventEmitter.on(NOTIFICATION_EVENTS.REQUESTED, listener);

    const result = await service.run();

    expect(result).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('com divergência: emite uma notificação agregada com severidade error', async () => {
    setup(
      [{ storeListingId: 's1', condition: 'new', type: StockMovementType.INBOUND, quantity: 5 }],
      [{ storeListingId: 's1', condition: 'new', onHand: 3 }],
    );
    const listener = jest.fn();
    eventEmitter.on(NOTIFICATION_EVENTS.REQUESTED, listener);

    const result = await service.run();

    expect(result).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: 'stock.divergence.detected',
      aggregateType: 'stock',
      severity: 'error',
      source: 'reconciliation',
      audience: { kind: 'all-admins' },
      data: { count: 1 },
    });
    expect(listener.mock.calls[0][0].deduplicationKey).toMatch(/^stock\.divergence\.detected:\d{4}-\d{2}-\d{2}$/);
  });

  it('não roda concorrentemente — segunda chamada enquanto a primeira está em andamento retorna vazio', async () => {
    let resolveFind: (v: any[]) => void;
    const pending = new Promise<any[]>((resolve) => { resolveFind = resolve; });
    eventEmitter = new EventEmitter2();
    service = new StockDivergenceReconcilerService(
      { find: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockReturnValue(pending) }) }) } as any,
      leanFind([]) as any,
      eventEmitter,
    );

    const first = service.run();
    const second = await service.run();

    expect(second).toEqual([]);
    resolveFind!([]);
    await first;
  });
});

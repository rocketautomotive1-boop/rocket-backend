import { PriceAlertService } from './price-alert.service';
import { PriceAnalysis } from '../analysis/price-analysis';
import { Types } from 'mongoose';

// allTimeLow abaixo dos preços testados (76/80) p/ exercitar below_moving_avg,
// não all_time_low (que tem precedência na ordem dos gatilhos).
const analysis: PriceAnalysis = {
  movingAvg: 100, allTimeLow: 70, validSnapshots: 10,
};

const makeItem = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  ean: '7896000001504',
  name: 'Coca-Cola lata',
  active: true,
  targetPrice: null,
  discountThresholdPct: 15,
  inDealSince: null,
  lastAlertAt: null,
  lastAlertPrice: null,
  ...overrides,
});

describe('PriceAlertService.processSnapshot', () => {
  let alertModel: { create: jest.Mock };
  let itemModel: { updateOne: jest.Mock };
  let emitter: { emit: jest.Mock };
  let service: PriceAlertService;

  beforeEach(() => {
    alertModel = { create: jest.fn().mockResolvedValue({}) };
    itemModel = { updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }) };
    emitter = { emit: jest.fn() };
    service = new PriceAlertService(alertModel as any, itemModel as any, emitter as any);
  });

  it('ENTRA em oferta → persiste alerta, marca inDealSince e emite notificação', async () => {
    const item = makeItem();
    const reason = await service.processSnapshot(item as any, 80, 5, analysis, null);
    expect(reason).toBe('below_moving_avg');
    expect(alertModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ ean: item.ean, reason: 'below_moving_avg', currentPrice: 80 }),
    );
    const [event, payload] = emitter.emit.mock.calls[0];
    expect(event).toBe('notification.requested');
    expect(payload.aggregateType).toBe('price-tracker');
    expect(payload.data.actionRoute).toBe(`/(drawer)/price-tracker/${item._id}`);
    const update = itemModel.updateOne.mock.calls[0][1].$set;
    expect(update.inDealSince).toBeInstanceOf(Date);
    expect(update.lastAlertPrice).toBe(80);
  });

  it('JÁ em oferta sem queda extra de 5% → cooldown bloqueia (sem alerta novo)', async () => {
    const item = makeItem({ inDealSince: new Date(), lastAlertPrice: 80 });
    const reason = await service.processSnapshot(item as any, 79, 5, analysis, null);
    expect(reason).toBeNull();
    expect(alertModel.create).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('JÁ em oferta com queda >= 5% → re-alerta', async () => {
    const item = makeItem({ inDealSince: new Date('2026-07-01'), lastAlertPrice: 80 });
    const reason = await service.processSnapshot(item as any, 76, 5, analysis, null);
    expect(reason).toBe('below_moving_avg');
    expect(alertModel.create).toHaveBeenCalled();
    // inDealSince original é preservado (não é uma entrada nova)
    const update = itemModel.updateOne.mock.calls[0][1].$set;
    expect(update.inDealSince).toEqual(new Date('2026-07-01'));
  });

  it('SAIU da oferta → limpa inDealSince, sem alerta', async () => {
    const item = makeItem({ inDealSince: new Date(), lastAlertPrice: 80 });
    const reason = await service.processSnapshot(item as any, 100, 5, analysis, null);
    expect(reason).toBeNull();
    expect(itemModel.updateOne).toHaveBeenCalledWith(
      { _id: item._id },
      { $set: { inDealSince: null } },
    );
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('fora de oferta e continua fora → não toca no banco', async () => {
    const item = makeItem();
    const reason = await service.processSnapshot(item as any, 100, 5, analysis, null);
    expect(reason).toBeNull();
    expect(itemModel.updateOne).not.toHaveBeenCalled();
  });
});

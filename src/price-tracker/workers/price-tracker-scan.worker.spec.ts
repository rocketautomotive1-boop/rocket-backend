import { PriceTrackerScanWorker } from './price-tracker-scan.worker';
import { Types } from 'mongoose';

const item = {
  _id: new Types.ObjectId(),
  ean: '7896000001504',
  name: 'Coca',
  active: true,
  discountThresholdPct: 15,
  targetPrice: null,
  inDealSince: null,
  lastAlertPrice: null,
};

const okResult = {
  correlation_id: 'c',
  ean: item.ean,
  desc: 'RAID MATA MOSCAS',
  stats: { min: 2.5, avg: 3, max: 5, count: 8 },
  offers: [
    {
      seller_name: 'MERCADO A', bairro: 'TIMBI', price: 2.5, list_price: 3.5, savings: 1.0,
      dist_km: 1.2, sold_at: '2026-07-05T10:00:00-03:00', sold_ago: 'há 2 horas', address: 'RUA X, 1',
    },
    { seller_name: 'MERCADO B', bairro: 'CENTRO', price: 3.0, dist_km: 4.0, sold_at: null, address: null },
  ],
};

function leanExec(value: any) {
  return { sort: () => ({ limit: () => ({ lean: () => ({ exec: async () => value }) }) }), lean: () => ({ exec: async () => value }) };
}

describe('PriceTrackerScanWorker', () => {
  let client: { fetch: jest.Mock };
  let itemModel: { find: jest.Mock; findOne: jest.Mock; updateOne: jest.Mock };
  let historyModel: { create: jest.Mock; find: jest.Mock };
  let alerts: { processSnapshot: jest.Mock };
  let worker: PriceTrackerScanWorker;

  beforeEach(() => {
    client = { fetch: jest.fn().mockResolvedValue(okResult) };
    itemModel = {
      find: jest.fn().mockReturnValue(leanExec([item])),
      findOne: jest.fn().mockReturnValue(leanExec(item)),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    historyModel = {
      create: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue(leanExec([])),
    };
    alerts = { processSnapshot: jest.fn().mockResolvedValue(null) };
    worker = new PriceTrackerScanWorker(
      client as any, itemModel as any, historyModel as any, alerts as any,
    );
    (worker as any).throttleMs = 0; // sem sleep nos testes
  });

  it('scanEan grava snapshot com bestOffer (menor preço, economia e tempo relativo) e chama o alert service', async () => {
    await worker.scanEan(item.ean);
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({
      ean: item.ean,
      stats: okResult.stats,
      bestOffer: expect.objectContaining({
        price: 2.5, listPrice: 3.5, savings: 1.0, sellerName: 'MERCADO A', soldAgo: 'há 2 horas',
      }),
      error: null,
    }));
    expect(alerts.processSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ ean: item.ean }),
      2.5, 8,
      expect.objectContaining({ validSnapshots: 0 }),
      expect.objectContaining({ price: 2.5 }),
    );
  });

  it('nome vazio → preenche com o desc da API (title case); nome do usuário é preservado', async () => {
    // Sem nome → autofill
    itemModel.findOne.mockReturnValueOnce(leanExec({ ...item, name: '' }));
    await worker.scanEan(item.ean);
    expect(itemModel.updateOne).toHaveBeenCalledWith(
      { _id: item._id },
      { $set: { name: 'Raid Mata Moscas' } },
    );
    expect(alerts.processSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Raid Mata Moscas' }),
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );

    // Com nome definido → não sobrescreve
    itemModel.updateOne.mockClear();
    await worker.scanEan(item.ean);
    expect(itemModel.updateOne).not.toHaveBeenCalled();
  });

  it('erro do scraper → snapshot com error gravado e SEM análise/alerta', async () => {
    client.fetch.mockResolvedValueOnce({ correlation_id: 'c', ean: item.ean, offers: [], error: 'timeout' });
    await worker.scanEan(item.ean);
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ error: 'timeout' }));
    expect(alerts.processSnapshot).not.toHaveBeenCalled();
  });

  it('runCycle pula quando já há ciclo rodando (guarda de sobreposição)', async () => {
    let release: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    client.fetch.mockImplementationOnce(async () => { await gate; return okResult; });

    const first = worker.runCycle();
    const second = worker.runCycle(); // deve retornar imediatamente sem escanear de novo
    release!();
    await Promise.all([first, second]);
    expect(client.fetch).toHaveBeenCalledTimes(1);
  });

  it('runCycle só escaneia itens ativos', async () => {
    await worker.runCycle();
    expect(itemModel.find).toHaveBeenCalledWith({ active: true });
  });
});

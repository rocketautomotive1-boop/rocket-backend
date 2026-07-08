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
  let currentOffersModel: { updateOne: jest.Mock };
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
    currentOffersModel = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    alerts = { processSnapshot: jest.fn().mockResolvedValue(null) };
    worker = new PriceTrackerScanWorker(
      client as any, itemModel as any, historyModel as any, currentOffersModel as any, alerts as any,
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

  it('scanEan grava TODAS as ofertas do ciclo (upsert por EAN), ordenadas da mais barata pra mais cara', async () => {
    await worker.scanEan(item.ean);
    expect(currentOffersModel.updateOne).toHaveBeenCalledWith(
      { ean: item.ean },
      {
        $set: {
          ean: item.ean,
          scannedAt: expect.any(Date),
          offers: [
            expect.objectContaining({ sellerName: 'MERCADO A', price: 2.5 }),
            expect.objectContaining({ sellerName: 'MERCADO B', price: 3.0 }),
          ],
        },
      },
      { upsert: true },
    );
  });

  it('current usa bestOffer.price (rastreável, com loja), NÃO stats.min — evita preço "fantasma"', async () => {
    // stats.min vem do campo agregado `precos.min` da API (todas as ofertas do
    // GTIN, sem filtro de UF/página); pode ser menor que qualquer oferta que de
    // fato apareceu em `offers` (ex.: oferta mais barata fora de PE ou além das
    // páginas buscadas). O preço usado pra alertar/analisar precisa ser
    // rastreável a uma oferta real e visível na lista do app.
    client.fetch.mockResolvedValueOnce({
      ...okResult,
      stats: { min: 0.50, avg: 3, max: 5, count: 8 }, // "fantasma": menor que qualquer offer
    });
    await worker.scanEan(item.ean);
    expect(alerts.processSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ ean: item.ean }),
      2.5, // bestOffer.price (MERCADO A), não 0.50 (stats.min)
      8,
      expect.anything(),
      expect.objectContaining({ price: 2.5 }),
    );
  });

  it('sem ofertas com preço (bestOffer null) → snapshot com error, SEM análise/alerta', async () => {
    client.fetch.mockResolvedValueOnce({ ...okResult, offers: [] });
    await worker.scanEan(item.ean);
    expect(historyModel.create).toHaveBeenCalledWith(expect.objectContaining({ error: 'no_offers' }));
    expect(alerts.processSnapshot).not.toHaveBeenCalled();
  });

  it('erro do scraper → NÃO grava current_offers', async () => {
    client.fetch.mockResolvedValueOnce({ correlation_id: 'c', ean: item.ean, offers: [], error: 'timeout' });
    await worker.scanEan(item.ean);
    expect(currentOffersModel.updateOne).not.toHaveBeenCalled();
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

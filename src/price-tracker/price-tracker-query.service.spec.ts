import { Types } from 'mongoose';
import { PriceTrackerQueryService } from './price-tracker-query.service';

const ITEM_ID = new Types.ObjectId();
const EAN = '7896000001504';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

function makeHistoryDoc(daysBack: number, min: number, listPrice: number | null = null) {
  return {
    ean: EAN,
    scannedAt: daysAgo(daysBack),
    stats: { min, avg: min, max: min, count: 5 },
    bestOffer: listPrice != null ? { listPrice } : null,
    error: null,
  };
}

describe('PriceTrackerQueryService.history', () => {
  let itemModel: any;
  let historyModel: any;
  let alertModel: any;
  let currentOffersModel: any;
  let service: PriceTrackerQueryService;

  const setupHistory = (docs: any[]) => {
    // history() faz 2 buscas: janela do gráfico (scannedAt >= since) e histórico
    // completo p/ windowLows (limit 400) — o mock devolve os mesmos docs pras duas.
    historyModel.find = jest.fn().mockReturnValue({
      sort: () => ({
        lean: () => ({ exec: async () => docs }),
        limit: () => ({ lean: () => ({ exec: async () => docs }) }),
      }),
    });
  };

  beforeEach(() => {
    itemModel = {
      findById: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ({ _id: ITEM_ID, ean: EAN }) }) }),
      find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: async () => [] }) }) }),
    };
    historyModel = {};
    alertModel = { find: jest.fn() };
    currentOffersModel = { findOne: jest.fn() };
    service = new PriceTrackerQueryService(itemModel, historyModel, alertModel, currentOffersModel);
  });

  it('windowLows reflete o mínimo dentro de cada janela, ignorando pontos fora dela', async () => {
    setupHistory([
      makeHistoryDoc(2, 10),   // dentro de 7/30/90
      makeHistoryDoc(20, 5),   // dentro de 30/90, fora de 7
      makeHistoryDoc(60, 2),   // dentro de 90 só
    ]);

    const result = await service.history(String(ITEM_ID), 30);

    expect(result.windowLows).toEqual({ d7: 10, d30: 5, d90: 2 });
  });

  it('série do gráfico expõe listPrice do bestOffer por ciclo (2ª linha do chart)', async () => {
    setupHistory([
      makeHistoryDoc(1, 10, 15),
      makeHistoryDoc(2, 12, null),
    ]);

    const result = await service.history(String(ITEM_ID), 30);

    expect(result.points[0]).toMatchObject({ min: 10, listPrice: 15 });
    expect(result.points[1]).toMatchObject({ min: 12, listPrice: null });
  });

  it('sem histórico → windowLows todo null', async () => {
    setupHistory([]);
    const result = await service.history(String(ITEM_ID), 30);
    expect(result.windowLows).toEqual({ d7: null, d30: null, d90: null });
  });
});

describe('PriceTrackerQueryService.listItems', () => {
  let itemModel: any;
  let historyModel: any;
  let service: PriceTrackerQueryService;

  const item = { _id: ITEM_ID, ean: EAN, name: 'Água', active: true, categoryId: null };

  beforeEach(() => {
    itemModel = { find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: async () => [item] }) }) }) };
    historyModel = { aggregate: jest.fn() };
    service = new PriceTrackerQueryService(itemModel, historyModel, {} as any, {} as any);
  });

  it('movingAvg vem da agregação (simula mediana no Mongo) — não confunde com stats.min', async () => {
    // A aggregation real usa $stats.median; aqui simulamos o resultado que ela
    // produziria: mediana estável em 100 mesmo com o snapshot mais recente
    // (stats.min) tendo caído pra 10 numa promoção relâmpago isolada.
    historyModel.aggregate.mockReturnValue({
      exec: async () => [{
        _id: EAN, lastPrice: 10, lastCount: 5, lastScannedAt: new Date(),
        allTimeLow: 10, movingAvg: 100,
      }],
    });

    const [view] = await service.listItems();

    expect(view.lastPrice).toBe(10);   // preço atual reflete a promoção real
    expect(view.movingAvg).toBe(100);  // "preço de mercado" NÃO foi puxado pro outlier
    expect(view.allTimeLow).toBe(10);
    expect(view.pctVsAvg).toBe(-90);   // (10-100)/100 = -90% — dispara alerta corretamente
  });

  it('sem histórico agregado (0 resultados) → movingAvg/allTimeLow null', async () => {
    historyModel.aggregate.mockReturnValue({ exec: async () => [] });
    const [view] = await service.listItems();
    expect(view.movingAvg).toBeNull();
    expect(view.allTimeLow).toBeNull();
    expect(view.pctVsAvg).toBeNull();
  });

  it('a pipeline de agregação usa stats.median para movingAvg, não stats.min', async () => {
    // Trava regressão: já existiu um bug em que essa 2ª implementação (aggregation
    // Mongo) ficou dessincronizada da lógica de price-analysis.ts (que usa mediana)
    // e continuou usando stats.min — mascarando o mesmo vício de outlier que a
    // mediana existe pra resolver.
    historyModel.aggregate.mockReturnValue({ exec: async () => [] });
    await service.listItems();

    const pipeline = historyModel.aggregate.mock.calls[0][0];
    const pipelineJson = JSON.stringify(pipeline);
    expect(pipelineJson).toContain('$stats.median');
    expect(pipelineJson).not.toMatch(/movingAvg[^}]*\$stats\.min/);
  });

  it('a pipeline de agregação usa bestOffer.price para lastPrice, não stats.min', async () => {
    // Mesma causa raiz do preço "fantasma" corrigida em price-tracker-scan.worker.ts:
    // stats.min é o campo agregado da API (sem filtro de UF/paginação), pode citar um
    // preço que não aparece em nenhuma oferta visível na lista do item. O preço
    // mostrado pro usuário (lastPrice) precisa vir de bestOffer.price (rastreável).
    historyModel.aggregate.mockReturnValue({ exec: async () => [] });
    await service.listItems();

    const pipeline = historyModel.aggregate.mock.calls[0][0];
    const pipelineJson = JSON.stringify(pipeline);
    expect(pipelineJson).toContain('$bestOffer.price');
    expect(pipelineJson).not.toMatch(/lastPrice[^}]*\$stats\.min/);
  });
});

describe('PriceTrackerQueryService.deals', () => {
  let itemModel: any;
  let historyModel: any;
  let alertModel: any;
  let service: PriceTrackerQueryService;

  const CAT_ID = new Types.ObjectId();
  const item = { _id: ITEM_ID, ean: EAN, name: 'Água', active: true, categoryId: CAT_ID };

  beforeEach(() => {
    itemModel = { find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: async () => [item] }) }) }) };
    historyModel = {
      aggregate: jest.fn().mockReturnValue({
        exec: async () => [{
          _id: EAN, lastPrice: 10, lastCount: 5, lastScannedAt: new Date(),
          allTimeLow: 10, movingAvg: 100,
        }],
      }),
    };
    alertModel = {
      find: jest.fn().mockReturnValue({
        sort: () => ({
          limit: () => ({
            lean: () => ({
              exec: async () => [{
                _id: new Types.ObjectId(), itemId: ITEM_ID, ean: EAN,
                triggeredAt: new Date(), reason: 'below_moving_avg', currentPrice: 10, movingAvg: 100,
              }],
            }),
          }),
        }),
      }),
    };
    service = new PriceTrackerQueryService(itemModel, historyModel, alertModel, {} as any);
  });

  it('cada alerta carrega o categoryId do item correspondente (agrupamento por categoria no frontend)', async () => {
    const result = await service.deals();
    expect(result.alerts[0].categoryId).toBe(String(CAT_ID));
  });

  it('item sem categoria → categoryId null no alerta', async () => {
    itemModel.find.mockReturnValue({
      sort: () => ({ lean: () => ({ exec: async () => [{ ...item, categoryId: null }] }) }),
    });
    const result = await service.deals();
    expect(result.alerts[0].categoryId).toBeNull();
  });
});

describe('PriceTrackerQueryService.listItemsPaged', () => {
  let itemModel: any;
  let historyModel: any;
  let service: PriceTrackerQueryService;

  const makeItems = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      _id: new Types.ObjectId(), ean: `EAN${i}`, name: `Item ${i}`, active: true, categoryId: null,
    }));

  beforeEach(() => {
    historyModel = { aggregate: jest.fn().mockReturnValue({ exec: async () => [] }) };
  });

  const setupItemModel = (allItems: any[], pageItems: any[]) => {
    itemModel = {
      countDocuments: jest.fn().mockReturnValue({ exec: async () => allItems.length }),
      find: jest.fn().mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: () => ({ exec: async () => pageItems }) }),
          }),
        }),
      }),
    };
    service = new PriceTrackerQueryService(itemModel, historyModel, {} as any, {} as any);
  };

  it('pagina no Mongo (skip/limit), não em memória — retorna só a página pedida + total real', async () => {
    const all = makeItems(45);
    setupItemModel(all, all.slice(20, 40)); // página 2, pageSize 20
    const result = await service.listItemsPaged({ page: 2, pageSize: 20 });

    expect(result.total).toBe(45);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(20);
    expect(result.items).toHaveLength(20);
  });

  it('aplica defaults (page 1, pageSize 20) quando omitidos', async () => {
    const all = makeItems(5);
    setupItemModel(all, all);
    const result = await service.listItemsPaged({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('lista vazia → items vazio, total 0, sem chamar aggregation', async () => {
    setupItemModel([], []);
    const result = await service.listItemsPaged({ page: 1, pageSize: 20 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(historyModel.aggregate).not.toHaveBeenCalled();
  });
});

describe('PriceTrackerQueryService.offers', () => {
  let itemModel: any;
  let currentOffersModel: any;
  let service: PriceTrackerQueryService;

  const makeOffer = (price: number) => ({ price, sellerName: `Loja ${price}` });

  beforeEach(() => {
    itemModel = {
      findById: jest.fn().mockReturnValue({ lean: () => ({ exec: async () => ({ _id: ITEM_ID, ean: EAN }) }) }),
    };
    currentOffersModel = { findOne: jest.fn() };
    service = new PriceTrackerQueryService(itemModel, {} as any, {} as any, currentOffersModel);
  });

  it('pagina o array já ordenado, sem reordenar', async () => {
    const offers = [1, 2, 3, 4, 5].map(makeOffer);
    currentOffersModel.findOne.mockReturnValue({
      lean: () => ({ exec: async () => ({ ean: EAN, scannedAt: new Date(), offers }) }),
    });

    const page1 = await service.offers(String(ITEM_ID), 1, 2);
    expect(page1.offers).toEqual([makeOffer(1), makeOffer(2)]);
    expect(page1.total).toBe(5);

    const page3 = await service.offers(String(ITEM_ID), 3, 2);
    expect(page3.offers).toEqual([makeOffer(5)]);
  });

  it('sem current_offers ainda coletado → lista vazia, total 0', async () => {
    currentOffersModel.findOne.mockReturnValue({ lean: () => ({ exec: async () => null }) });
    const result = await service.offers(String(ITEM_ID), 1, 20);
    expect(result).toEqual({ offers: [], total: 0, page: 1, pageSize: 20, scannedAt: null });
  });
});

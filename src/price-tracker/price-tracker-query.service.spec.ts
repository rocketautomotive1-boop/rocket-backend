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

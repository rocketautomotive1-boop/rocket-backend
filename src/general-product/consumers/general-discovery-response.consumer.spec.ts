// backend/src/general-product/consumers/general-discovery-response.consumer.spec.ts
import { GeneralDiscoveryResponseConsumer } from './general-discovery-response.consumer';

describe('GeneralDiscoveryResponseConsumer', () => {
  const makeRepo = () => ({ upsertDraftByBarcode: jest.fn().mockResolvedValue(undefined) });

  it('upserts draft on a completed response', async () => {
    const repo = makeRepo();
    const consumer = new GeneralDiscoveryResponseConsumer(repo as any);

    await consumer.handle({
      jobId: 'j1',
      barcode: '7891000100103',
      status: 'completed',
      result: { titles: ['Nescau 400g'] },
    } as any);

    // draft inclui o result da IA + priceStats/images/sources (defaults quando ausentes)
    expect(repo.upsertDraftByBarcode).toHaveBeenCalledWith('7891000100103', {
      titles: ['Nescau 400g'],
      priceStats: null,
      images: [],
      sources: null,
    });
  });

  it('merges real ML priceStats, images and individual listings (sources) into the draft', async () => {
    const repo = makeRepo();
    const consumer = new GeneralDiscoveryResponseConsumer(repo as any);

    const sources = {
      mercadolivre: { items: [{ url: 'u1', title: 'Óleo Elseve', price: 35.9 }], confidence: 'high' },
      serp: { items: [], confidence: 'none' },
    };
    await consumer.handle({
      jobId: 'j1',
      barcode: '7899026478909',
      status: 'completed',
      result: { titles: ['Óleo Elseve'] },
      priceStats: { min: 35.9, avg: 37.9, max: 39.9, count: 2 },
      images: ['img1', 'img2'],
      sources,
    } as any);

    expect(repo.upsertDraftByBarcode).toHaveBeenCalledWith('7899026478909', {
      titles: ['Óleo Elseve'],
      priceStats: { min: 35.9, avg: 37.9, max: 39.9, count: 2 },
      images: ['img1', 'img2'],
      sources,
    });
  });

  it('does NOT upsert on a failed response', async () => {
    const repo = makeRepo();
    const consumer = new GeneralDiscoveryResponseConsumer(repo as any);

    await consumer.handle({
      jobId: 'j1',
      barcode: '7891000100103',
      status: 'failed',
      error: 'ai down',
    } as any);

    expect(repo.upsertDraftByBarcode).not.toHaveBeenCalled();
  });

  it('does NOT upsert when result is missing on a completed response', async () => {
    const repo = makeRepo();
    const consumer = new GeneralDiscoveryResponseConsumer(repo as any);

    await consumer.handle({ jobId: 'j1', barcode: '7891000100103', status: 'completed' } as any);

    expect(repo.upsertDraftByBarcode).not.toHaveBeenCalled();
  });
});

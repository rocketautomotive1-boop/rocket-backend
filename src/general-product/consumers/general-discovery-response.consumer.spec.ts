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

    expect(repo.upsertDraftByBarcode).toHaveBeenCalledWith('7891000100103', { titles: ['Nescau 400g'] });
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

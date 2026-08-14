import { Types } from 'mongoose';
import { SourceRefreshResponseConsumer } from './source-refresh-response.consumer';

const PRODUCT_ID = new Types.ObjectId().toHexString();

function makeConsumer(existingDoc: any = null) {
  const updateCalls: any[] = [];
  const discoveryModel: any = {
    updateOne: jest.fn().mockImplementation((filter: any, update: any, opts: any) => {
      updateCalls.push({ filter, update, opts });
      return { exec: async () => undefined };
    }),
    findOne: jest.fn().mockReturnValue({
      select: () => ({ lean: () => ({ exec: async () => existingDoc }) }),
    }),
  };
  const eventEmitter = { emit: jest.fn() };
  const consumer = new SourceRefreshResponseConsumer(discoveryModel, eventEmitter as any);
  return { consumer, updateCalls, eventEmitter, discoveryModel };
}

const okBlock = { stats: { min: 1, avg: 2, max: 3, count: 2 }, offers: [{ seller_name: 'LOJA', price: 1 }] };

describe('SourceRefreshResponseConsumer', () => {
  it('faz $set por caminho aninhado em sources.menorPreco (não toca outras fontes)', async () => {
    const { consumer, updateCalls } = makeConsumer();
    await consumer.handle({
      productId: PRODUCT_ID,
      source: 'menorPreco',
      correlationId: 'corr',
      jobId: 'job',
      block: okBlock,
    });

    expect(updateCalls).toHaveLength(1);
    const { update } = updateCalls[0];
    // Toca SÓ a chave da fonte — chave dot-path, não o objeto sources inteiro.
    expect(Object.keys(update.$set)).toEqual(
      expect.arrayContaining(['sources.menorPreco', 'updatedAt']),
    );
    expect(update.$set).not.toHaveProperty('sources');
    expect(update.$set['sources.menorPreco'].offers[0].seller_name).toBe('LOJA');
    expect(update.$set['sources.menorPreco'].confidence).toBe('high');
  });

  it('usa upsert com $setOnInsert para criar doc mínimo quando não há discovery', async () => {
    const { consumer, updateCalls } = makeConsumer();
    await consumer.handle({
      productId: PRODUCT_ID, source: 'menorPreco', correlationId: 'c', jobId: 'job', block: okBlock,
    });
    const { opts, update, filter } = updateCalls[0];
    expect(opts).toEqual({ upsert: true });
    expect(filter).toEqual(
      expect.objectContaining({ isActiveIntent: true, status: { $ne: 'superseded' } }),
    );
    expect(update.$setOnInsert).toEqual(
      expect.objectContaining({ batchId: 'job', status: 'done', isActiveIntent: true, intentVersion: 1 }),
    );
  });

  it('NÃO escreve quando block é null e emite FAILED', async () => {
    const { consumer, updateCalls, eventEmitter } = makeConsumer();
    await consumer.handle({
      productId: PRODUCT_ID, source: 'menorPreco', correlationId: 'c', jobId: 'job', block: null, error: 'timeout',
    });

    expect(updateCalls).toHaveLength(0);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'queue.job.update',
      expect.objectContaining({ jobId: 'job', status: 'FAILED', error: 'timeout' }),
    );
  });

  it('emite COMPLETED com o contrato normalizado após o save', async () => {
    const existingDoc = { sources: { menorPreco: okBlock }, final: { titles: ['X'] } };
    const { consumer, eventEmitter } = makeConsumer(existingDoc);
    await consumer.handle({
      productId: PRODUCT_ID, source: 'menorPreco', correlationId: 'c', jobId: 'job', block: okBlock,
    });

    const completion = (eventEmitter.emit as jest.Mock).mock.calls.find(
      ([name, ev]) => name === 'queue.job.update' && ev?.status === 'COMPLETED',
    );
    expect(completion).toBeDefined();
    expect(completion![1].result.menorPreco.offers[0].seller_name).toBe('LOJA');
  });

  it('confidence none quando o bloco vem sem ofertas', async () => {
    const { consumer, updateCalls } = makeConsumer();
    await consumer.handle({
      productId: PRODUCT_ID, source: 'menorPreco', correlationId: 'c', jobId: 'job',
      block: { stats: null, offers: [] },
    });
    expect(updateCalls[0].update.$set['sources.menorPreco'].confidence).toBe('none');
  });
});

import { OrderProcessor } from './order.processor';

describe('OrderProcessor.processOrdersSync', () => {
  function makeCtx() {
    const ack = jest.fn();
    const ctx = {
      getChannelRef: () => ({ ack }),
      getMessage: () => ({ content: Buffer.from(JSON.stringify({ data: {} })) }),
    };
    return { ctx, ack };
  }

  function makeSut(record: any) {
    const queueRecordModel = { findById: jest.fn(() => ({ exec: () => Promise.resolve(record) })) };
    const queueService = {
      updateQueueRecord: jest.fn().mockResolvedValue(undefined),
      startJob: jest.fn().mockResolvedValue(undefined),
      completeJob: jest.fn().mockResolvedValue(undefined),
      failJob: jest.fn().mockResolvedValue(undefined),
      handleProcessFailure: jest.fn().mockResolvedValue(undefined),
    };
    const eventEmitter = { emitAsync: jest.fn().mockResolvedValue([]), emit: jest.fn() };
    const sut = new OrderProcessor(queueRecordModel as any, queueService as any, eventEmitter as any);
    return { sut, queueService, eventEmitter };
  }

  it('job COM externalId delega ao pipeline via emitAsync (ramo novo)', async () => {
    const record = { _id: 'r1', metadata: { externalId: 'EXT-1', marketplaceId: 'M1' }, marketplaceId: 'M1' };
    const { sut, eventEmitter } = makeSut(record);
    const { ctx, ack } = makeCtx();
    await sut.processOrdersSync({ queueRecordId: 'r1' }, ctx as any);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith('orders-sync', expect.objectContaining({ externalId: 'EXT-1' }));
    expect(ack).toHaveBeenCalled();
  });

  it('job SEM externalId é no-op (não deduz estoque), apenas ack', async () => {
    const record = { _id: 'r2', metadata: { marketplaceId: 'M1' }, marketplaceId: 'M1' };
    const { sut, eventEmitter, queueService } = makeSut(record);
    const { ctx, ack } = makeCtx();
    await sut.processOrdersSync({ queueRecordId: 'r2' }, ctx as any);
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalled();
  });
});

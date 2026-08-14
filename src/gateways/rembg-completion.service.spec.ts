import { RembgCompletionService } from './rembg-completion.service';

/**
 * Proves the money-safety + convergence invariants without a live Mongo:
 *  - success persists the repository row (by jobId) then fills the slot then closes the job
 *  - a duplicate success on an already-done job is a no-op (no double repo write / slot fill)
 *  - failure retries with backoff, then terminally fails the job AND the slot
 */
function makeSut(job: any) {
  const jobs: any = {
    findById: jest.fn().mockResolvedValue(job ? { ...job } : null),
    updateOne: jest.fn().mockResolvedValue({}),
    find: jest.fn().mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }) }),
  };
  const productModel: any = { updateOne: jest.fn().mockResolvedValue({}) };
  const processedImageService: any = {
    saveProcessedImage: jest.fn().mockResolvedValue({ id: 'pi1' }),
  };
  const roomEmit = jest.fn();
  const gateway: any = { server: { emit: jest.fn(), to: jest.fn().mockReturnValue({ emit: roomEmit }) } };
  gateway.roomEmit = roomEmit;
  const s3: any = { deleteFile: jest.fn().mockResolvedValue(undefined) };
  const eventEmitter: any = { emit: jest.fn() };

  const sut = new RembgCompletionService(jobs, productModel, processedImageService, gateway, s3, eventEmitter);
  return { sut, jobs, productModel, processedImageService, gateway, s3, eventEmitter };
}

const baseJob = {
  _id: 'job1',
  productId: 'prod1',
  slotId: 'slot1',
  batchCode: 'RB-1',
  batchNote: null,
  rawS3Key: 'rembg-raw/prod1/RB-1/x.jpg',
  status: 'dispatched',
  attempts: 1,
  source: null,
};

describe('RembgCompletionService.applySuccess', () => {
  it('persists repository by jobId, fills the slot, then closes the job', async () => {
    const { sut, jobs, productModel, processedImageService, s3 } = makeSut(baseJob);

    await sut.applySuccess('job1', { url: 'https://s3/out.png', key: 'rembg-processed/out.png', source: 'photoroom' });

    // Repository first — keyed by jobId (idempotent, never lose the paid artifact).
    expect(processedImageService.saveProcessedImage).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job1', key: 'rembg-processed/out.png', url: 'https://s3/out.png' }),
    );
    // Slot filled to active (positional by slotId).
    expect(productModel.updateOne).toHaveBeenCalledWith(
      { _id: 'prod1', 'images.slotId': 'slot1' },
      expect.objectContaining({ $set: expect.objectContaining({ 'images.$.status': 'active' }) }),
    );
    // Job closed as done.
    expect(jobs.updateOne).toHaveBeenCalledWith(
      { _id: 'job1' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'done', processedImageId: 'pi1' }) }),
    );
    // Raw cleaned up.
    expect(s3.deleteFile).toHaveBeenCalledWith(baseJob.rawS3Key);
  });

  it('is a no-op when the job is already done (duplicate/late callback)', async () => {
    const { sut, productModel, processedImageService, jobs } = makeSut({ ...baseJob, status: 'done' });

    await sut.applySuccess('job1', { url: 'https://s3/out.png', key: 'k', source: 'photoroom' });

    expect(processedImageService.saveProcessedImage).not.toHaveBeenCalled();
    expect(productModel.updateOne).not.toHaveBeenCalled();
    expect(jobs.updateOne).not.toHaveBeenCalled();
  });
});

describe('RembgCompletionService.applyFailure (processing error)', () => {
  it('consumes an attempt and reschedules with backoff while attempts remain', async () => {
    const { sut, jobs, productModel } = makeSut({ ...baseJob, attempts: 0 });

    await sut.applyFailure('job1', 'provider 500');

    expect(jobs.updateOne).toHaveBeenCalledWith(
      { _id: 'job1' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'pending', nextRetryAt: expect.any(Date) }),
        $inc: { attempts: 1 },
      }),
    );
    // Slot is NOT failed yet.
    expect(productModel.updateOne).not.toHaveBeenCalled();
  });

  it('terminally fails the job AND the slot once attempts are exhausted', async () => {
    const { sut, jobs, productModel, gateway } = makeSut({ ...baseJob, attempts: 2 });

    await sut.applyFailure('job1', 'provider down');

    expect(jobs.updateOne).toHaveBeenCalledWith(
      { _id: 'job1' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
    );
    expect(productModel.updateOne).toHaveBeenCalledWith(
      { _id: 'prod1', 'images.slotId': 'slot1' },
      { $set: { 'images.$.status': 'failed' } },
    );
    expect(gateway.server.emit).toHaveBeenCalledWith('rembg:job:failed', expect.objectContaining({ jobId: 'job1' }));
  });

  it('ignores a job already in a terminal state', async () => {
    const { sut, jobs } = makeSut({ ...baseJob, status: 'failed' });
    await sut.applyFailure('job1', 'late error');
    expect(jobs.updateOne).not.toHaveBeenCalled();
  });

  it('a PERMANENT error fails terminally on the first try (no retry, marks permanentFailure)', async () => {
    const { sut, jobs, productModel } = makeSut({ ...baseJob, attempts: 0 });

    await sut.applyFailure('job1', 'image too small: 1x1', true);

    expect(jobs.updateOne).toHaveBeenCalledWith(
      { _id: 'job1' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'failed', permanentFailure: true }) }),
    );
    expect(productModel.updateOne).toHaveBeenCalledWith(
      { _id: 'prod1', 'images.slotId': 'slot1' },
      { $set: { 'images.$.status': 'failed' } },
    );
  });
});

describe('RembgCompletionService.applyDeliveryFailure (service down)', () => {
  it('requeues WITHOUT consuming an attempt or failing the slot', async () => {
    const { sut, jobs, productModel } = makeSut({ ...baseJob, attempts: 2 });

    await sut.applyDeliveryFailure('job1', '404 Not Found');

    const call = jobs.updateOne.mock.calls[0][1];
    expect(call.$set.status).toBe('pending');
    expect(call.$inc).toBeUndefined(); // attempts untouched
    expect(productModel.updateOne).not.toHaveBeenCalled(); // slot NOT failed
  });

  it('is a no-op for a job already done/failed', async () => {
    const { sut, jobs } = makeSut({ ...baseJob, status: 'done' });
    await sut.applyDeliveryFailure('job1', 'refused');
    expect(jobs.updateOne).not.toHaveBeenCalled();
  });
});

describe('RembgCompletionService.reconcileProduct (self-healing reconnect)', () => {
  // Replays the CURRENT batch state to a (re)subscribing client's room so a missed
  // `rembg:batch:done` (client was disconnected when it fired) no longer leaves the UI
  // stuck on "processing" — the exact symptom the fix targets.
  function makeReconcileSut(jobDocs: Array<{ batchCode: string; status: string }>) {
    const { sut, gateway } = makeSut(baseJob);
    // Override find() to return the provided batch jobs for this product.
    (sut as any).rembgJobModel.find = jest
      .fn()
      .mockReturnValue({ select: () => ({ lean: () => Promise.resolve(jobDocs) }) });
    return { sut, gateway };
  }

  it('emits batch:done into the product room when every job of a batch is terminal', async () => {
    const { sut, gateway } = makeReconcileSut([
      { batchCode: 'RB-1', status: 'done' },
      { batchCode: 'RB-1', status: 'done' },
      { batchCode: 'RB-1', status: 'failed' },
    ]);

    await sut.reconcileProduct({ productId: 'prod1' });

    expect(gateway.server.to).toHaveBeenCalledWith('product_prod1');
    expect(gateway.roomEmit).toHaveBeenCalledWith(
      'rembg:batch:progress',
      expect.objectContaining({ productId: 'prod1', batchCode: 'RB-1', total: 3, done: 2, failed: 1, completed: true }),
    );
    expect(gateway.roomEmit).toHaveBeenCalledWith(
      'rembg:batch:done',
      expect.objectContaining({ productId: 'prod1', batchCode: 'RB-1', total: 3, done: 2, failed: 1 }),
    );
  });

  it('emits progress WITHOUT done while a batch is still processing', async () => {
    const { sut, gateway } = makeReconcileSut([
      { batchCode: 'RB-2', status: 'done' },
      { batchCode: 'RB-2', status: 'dispatched' },
    ]);

    await sut.reconcileProduct({ productId: 'prod1' });

    expect(gateway.roomEmit).toHaveBeenCalledWith(
      'rembg:batch:progress',
      expect.objectContaining({ batchCode: 'RB-2', completed: false }),
    );
    expect(gateway.roomEmit).not.toHaveBeenCalledWith('rembg:batch:done', expect.anything());
  });

  it('is a no-op when the product has no jobs', async () => {
    const { sut, gateway } = makeReconcileSut([]);
    await sut.reconcileProduct({ productId: 'prod1' });
    expect(gateway.server.to).not.toHaveBeenCalled();
  });
});

describe('RembgCompletionService.emitBatchState — readiness loop', () => {
  // When rembg finishes a batch it is an async change to the product's images that no
  // section-save emits. emitBatchState must emit IMAGES_SAVED so ProductReadinessService
  // recomputes → fires BECAME_READY → auto-publishes. This is the fix for "product never
  // publishes after rembg finishes".
  function makeSutWithJobs(jobDocs: Array<{ status: string }>) {
    const { sut, eventEmitter, gateway } = makeSut(baseJob);
    (sut as any).rembgJobModel.find = jest
      .fn()
      .mockReturnValue({ select: () => ({ lean: () => Promise.resolve(jobDocs) }) });
    return { sut, eventEmitter, gateway };
  }

  it('emits IMAGES_SAVED once the batch is fully terminal', async () => {
    const { sut, eventEmitter } = makeSutWithJobs([{ status: 'done' }, { status: 'done' }]);

    await sut.emitBatchState('prod1', 'RB-1');

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'product.images.saved',
      expect.objectContaining({ productId: 'prod1' }),
    );
  });

  it('does NOT emit IMAGES_SAVED while the batch is still processing', async () => {
    const { sut, eventEmitter } = makeSutWithJobs([{ status: 'done' }, { status: 'dispatched' }]);

    await sut.emitBatchState('prod1', 'RB-1');

    expect(eventEmitter.emit).not.toHaveBeenCalledWith('product.images.saved', expect.anything());
  });
});

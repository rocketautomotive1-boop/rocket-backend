import { RembgReconciler } from './rembg-reconciler.service';

function makeSut(opts: { slots: any[]; jobFor: (slotId: string) => any; rawExists?: boolean }) {
  const productModel: any = {
    find: jest.fn().mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: () => Promise.resolve([{ _id: 'prod1', images: opts.slots }]),
        }),
      }),
    }),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  const jobs: any = {
    findOne: jest.fn().mockImplementation((q: any) => ({
      sort: () => ({ lean: () => Promise.resolve(opts.jobFor(q.slotId)) }),
    })),
    create: jest.fn().mockResolvedValue({ _id: 'newjob' }),
  };
  const completion: any = {
    applySuccess: jest.fn().mockResolvedValue(undefined),
    markSlotFailed: jest.fn().mockResolvedValue(undefined),
  };
  const s3: any = { fileExists: jest.fn().mockResolvedValue(opts.rawExists ?? true) };
  const sut = new RembgReconciler(jobs, productModel, completion, s3);
  return { sut, jobs, completion, productModel, s3 };
}

const slot = (slotId: string, over: any = {}) => ({ status: 'processing', slotId, url: 'preview', key: 'raw/x.jpg', ...over });

describe('RembgReconciler', () => {
  it('recreates a pending job for a processing slot with no live job (raw present)', async () => {
    const { sut, jobs } = makeSut({ slots: [slot('s1')], jobFor: () => null, rawExists: true });

    await sut.reconcile();

    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'prod1', slotId: 's1', rawS3Key: 'raw/x.jpg', status: 'pending' }),
    );
  });

  it('leaves slots that already have a live (pending/dispatched) job alone', async () => {
    const { sut, jobs, completion } = makeSut({
      slots: [slot('s1')],
      jobFor: () => ({ _id: 'j1', status: 'dispatched' }),
    });

    await sut.reconcile();

    expect(jobs.create).not.toHaveBeenCalled();
    expect(completion.applySuccess).not.toHaveBeenCalled();
    expect(completion.markSlotFailed).not.toHaveBeenCalled();
  });

  it('re-applies a done job whose slot missed the fill', async () => {
    const { sut, completion } = makeSut({
      slots: [slot('s1', { url: 'preview' })],
      jobFor: () => ({ _id: 'j1', status: 'done', processedImageKey: 'rembg-processed/out.png', source: 'photoroom' }),
    });

    await sut.reconcile();

    expect(completion.applySuccess).toHaveBeenCalledWith('j1', expect.objectContaining({ key: 'rembg-processed/out.png' }));
  });

  it('retries a FAILED slot whose raw still exists, resetting it to processing', async () => {
    const { sut, jobs, productModel } = makeSut({
      slots: [slot('s1', { status: 'failed' })],
      jobFor: () => ({ _id: 'j1', status: 'failed', batchCode: 'RB-old' }),
      rawExists: true,
    });

    await sut.reconcile();

    expect(jobs.create).toHaveBeenCalledWith(expect.objectContaining({ slotId: 's1', status: 'pending' }));
    // Slot flipped back to processing so the UI shows activity again.
    expect(productModel.updateOne).toHaveBeenCalledWith(
      { _id: 'prod1', 'images.slotId': 's1' },
      { $set: { 'images.$.status': 'processing' } },
    );
  });

  it('does NOT retry a PERMANENTLY-failed slot even if the raw still exists', async () => {
    const { sut, jobs, completion } = makeSut({
      slots: [slot('s1', { status: 'failed' })],
      jobFor: () => ({ _id: 'j1', status: 'failed', permanentFailure: true }),
      rawExists: true,
    });

    await sut.reconcile();

    expect(jobs.create).not.toHaveBeenCalled();
    expect(completion.markSlotFailed).not.toHaveBeenCalled();
  });

  it('does NOT retry (and does not re-fail) a failed slot whose raw is gone', async () => {
    const { sut, jobs, completion } = makeSut({
      slots: [slot('s1', { status: 'failed' })],
      jobFor: () => ({ _id: 'j1', status: 'failed' }),
      rawExists: false,
    });

    await sut.reconcile();

    expect(jobs.create).not.toHaveBeenCalled();
    // Already failed → no redundant markSlotFailed.
    expect(completion.markSlotFailed).not.toHaveBeenCalled();
  });

  it('fails a processing slot that has neither a job nor a raw to reprocess', async () => {
    const { sut, completion, jobs } = makeSut({
      slots: [slot('s1', { key: undefined })],
      jobFor: () => null,
      rawExists: false,
    });

    await sut.reconcile();

    expect(jobs.create).not.toHaveBeenCalled();
    expect(completion.markSlotFailed).toHaveBeenCalledWith('prod1', 's1');
  });
});

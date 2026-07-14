import { ProcessedImageService } from './processed-image.service';

function makeSut() {
  const model: any = {
    create: jest.fn().mockImplementation((d: any) => Promise.resolve({ _id: 'created', ...d })),
    findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'upserted', jobId: 'job1', url: 'u', key: 'k' }),
  };
  const sut = new ProcessedImageService(model);
  return { sut, model };
}

describe('ProcessedImageService.saveProcessedImage', () => {
  const base = { batchCode: 'RB-1', url: 'https://s3/out.png', key: 'rembg-processed/out.png' };

  it('upserts by jobId when jobId is present (idempotent — never double-charges)', async () => {
    const { sut, model } = makeSut();

    await sut.saveProcessedImage({ ...base, jobId: 'job1' });

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { jobId: 'job1' },
      expect.objectContaining({ $setOnInsert: { jobId: 'job1' } }),
      expect.objectContaining({ upsert: true }),
    );
    expect(model.create).not.toHaveBeenCalled();
  });

  it('creates a plain row when there is no jobId (non-job sources)', async () => {
    const { sut, model } = makeSut();

    await sut.saveProcessedImage(base);

    expect(model.create).toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

import { RembgDispatchWorker } from './rembg-dispatch.worker';

function makeSut(claimResults: any[]) {
  let call = 0;
  const jobs: any = {
    findOneAndUpdate: jest.fn().mockImplementation(() => Promise.resolve(claimResults[call++] ?? null)),
  };
  const completion: any = {
    applyFailure: jest.fn().mockResolvedValue(undefined),
    applyDeliveryFailure: jest.fn().mockResolvedValue(undefined),
  };
  const config: any = {
    get: (k: string) =>
      ({ REMBG_URL: 'http://rembg:8000', PUBLIC_BACKEND_URL: 'http://backend:3000', INTERNAL_API_KEY: 'secret' }[k]),
  };
  const sut = new RembgDispatchWorker(jobs, completion, config);
  return { sut, jobs, completion };
}

const job = (over: any = {}) => ({
  _id: 'job1', productId: 'p1', slotId: 's1', rawS3Key: 'raw/x.jpg',
  batchCode: 'RB-1', batchNote: null, options: { crop: true }, ...over,
});

describe('RembgDispatchWorker', () => {
  const origFetch = global.fetch;
  afterEach(() => { (global as any).fetch = origFetch; jest.clearAllMocks(); });

  it('claims eligible jobs (pending due, or dispatched with expired lease)', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    const { sut, jobs } = makeSut([job(), null]);

    await sut.tick();

    const query = jobs.findOneAndUpdate.mock.calls[0][0];
    expect(JSON.stringify(query)).toContain('pending');
    expect(JSON.stringify(query)).toContain('dispatched');
    // Leases the claim atomically — but does NOT consume an attempt (that's for real
    // processing failures only, so a reclaim/restart never burns the retry budget).
    const update = jobs.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set.status).toBe('dispatched');
    expect(update.$inc).toBeUndefined();
  });

  it('POSTs the job to the microservice with a callback URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    (global as any).fetch = fetchMock;
    const { sut } = makeSut([job(), null]);

    await sut.tick();
    // wait for the fire-and-forget dispatch
    await new Promise((r) => setImmediate(r));

    expect(fetchMock).toHaveBeenCalledWith('http://rembg:8000/process', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ jobId: 'job1', rawKey: 'raw/x.jpg', callbackUrl: 'http://backend:3000/internal/rembg/result' });
  });

  it('a failed delivery is requeued WITHOUT consuming an attempt (delivery failure)', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'down' });
    const { sut, completion } = makeSut([job(), null]);

    await sut.tick();
    await new Promise((r) => setImmediate(r));

    expect(completion.applyDeliveryFailure).toHaveBeenCalledWith('job1', expect.stringContaining('503'));
    expect(completion.applyFailure).not.toHaveBeenCalled();
  });

  it('does nothing when no job is claimable', async () => {
    const fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    const { sut } = makeSut([null]);

    await sut.tick();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

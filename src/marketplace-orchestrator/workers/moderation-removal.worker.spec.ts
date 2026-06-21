import { ModerationRemovalWorker } from './moderation-removal.worker';

describe('ModerationRemovalWorker', () => {
  let listingModel: { find: jest.Mock; updateOne: jest.Mock };
  let removal: { removeListing: jest.Mock };
  let worker: ModerationRemovalWorker;

  const findReturns = (docs: any[]) =>
    listingModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue(docs) });

  beforeEach(() => {
    listingModel = {
      find: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };
    removal = { removeListing: jest.fn().mockResolvedValue({ queued: true }) };
    worker = new ModerationRemovalWorker(listingModel as any, removal as any);
    delete process.env.MODERATION_REMOVAL_ENABLED;
  });

  it('dispatches removal for a pending_removal listing and bumps attempts', async () => {
    findReturns([{ _id: 'L1', externalId: 'MLB1', marketplaceData: {} }]);

    await worker.run();

    expect(removal.removeListing).toHaveBeenCalledWith('L1');
    expect(listingModel.updateOne).toHaveBeenCalledWith(
      { _id: 'L1' },
      expect.objectContaining({
        $set: expect.objectContaining({ 'marketplaceData.removal_attempts': 1 }),
      }),
    );
  });

  it('respects exponential backoff (skips a recently-attempted listing)', async () => {
    findReturns([
      {
        _id: 'L1',
        externalId: 'MLB1',
        marketplaceData: { removal_attempts: 1, removal_last_attempt_at: new Date() },
      },
    ]);

    await worker.run();

    expect(removal.removeListing).not.toHaveBeenCalled();
  });

  it('marks removal_failed after MAX_ATTEMPTS when removal keeps throwing', async () => {
    removal.removeListing.mockRejectedValue(new Error('boom'));
    findReturns([
      {
        _id: 'L1',
        externalId: 'MLB1',
        marketplaceData: {
          removal_attempts: 2,
          removal_last_attempt_at: new Date(Date.now() - 999 * 60 * 1000),
        },
      },
    ]);

    await worker.run();

    expect(listingModel.updateOne).toHaveBeenCalledWith(
      { _id: 'L1' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'removal_failed' }) }),
    );
  });

  it('is disabled via MODERATION_REMOVAL_ENABLED=false', async () => {
    process.env.MODERATION_REMOVAL_ENABLED = 'false';
    await worker.run();
    expect(listingModel.find).not.toHaveBeenCalled();
  });

  it('does not re-publish — only dispatches removal', async () => {
    findReturns([{ _id: 'L1', externalId: 'MLB1', marketplaceData: {} }]);
    await worker.run();
    // the worker has no publisher; the only outward action is removeListing
    expect(removal.removeListing).toHaveBeenCalledTimes(1);
  });
});

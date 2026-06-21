import { ModerationReconciler } from './moderation-reconciler.service';

/**
 * Focus: the diff-driven runFor — ingest active infractions AND close (resolve) open rows that
 * vanished from /infractions. Timers/scheduling are not asserted (setTimeout is fire-and-forget).
 */
describe('ModerationReconciler.runFor', () => {
  let listingModel: { findOne: jest.Mock };
  let registry: any;
  let broker: { ensureValidToken: jest.Mock; ensureValidTokenByAccount: jest.Mock };
  let mlClient: {
    getAllInfractions: jest.Mock;
    getLastModeration: jest.Mock;
    getItemCategoryId: jest.Mock;
  };
  let repo: { findAllOpen: jest.Mock; markResolved: jest.Mock };
  let ingest: { ingest: jest.Mock };
  let publisher: { requestSync: jest.Mock };
  let reconciler: ModerationReconciler;

  beforeEach(() => {
    listingModel = { findOne: jest.fn() };
    registry = { findAll: jest.fn() };
    broker = {
      ensureValidToken: jest.fn().mockResolvedValue({ accessToken: 'tok', additionalData: { userId: 99 } }),
      ensureValidTokenByAccount: jest.fn(),
    };
    mlClient = {
      getAllInfractions: jest.fn().mockResolvedValue([]),
      getLastModeration: jest.fn().mockResolvedValue(undefined),
      getItemCategoryId: jest.fn().mockResolvedValue('MLB-CAT'),
    };
    repo = { findAllOpen: jest.fn().mockResolvedValue([]), markResolved: jest.fn().mockResolvedValue(undefined) };
    ingest = { ingest: jest.fn().mockResolvedValue({ outcome: 'handled', externalId: 'x' }) };
    publisher = { requestSync: jest.fn().mockResolvedValue(undefined) };

    reconciler = new ModerationReconciler(
      listingModel as any,
      registry,
      broker as any,
      mlClient as any,
      repo as any,
      ingest as any,
      publisher as any,
    );
    // prevent real timers from being scheduled after the run
    jest.spyOn<any, any>(reconciler as any, 'scheduleNext').mockImplementation(() => undefined);
  });

  it('ingests each active infraction', async () => {
    mlClient.getAllInfractions.mockResolvedValue([
      { element_id: 'MLB1', filter_subgroup: 'DOMAIN' },
      { element_id: 'MLB2', filter_subgroup: 'COMPATS' },
    ]);

    await reconciler.runFor('M1');

    expect(ingest.ingest).toHaveBeenCalledTimes(2);
    // wrong-category resolves blocked category; compats does not
    expect(mlClient.getItemCategoryId).toHaveBeenCalledWith('MLB1', 'tok');
    expect(mlClient.getItemCategoryId).not.toHaveBeenCalledWith('MLB2', 'tok');
  });

  it('resolves an open row that disappeared from /infractions (clears listing + re-publish)', async () => {
    mlClient.getAllInfractions.mockResolvedValue([]); // nothing active now
    repo.findAllOpen.mockResolvedValue([
      { _id: 'S1', externalId: 'MLB-GONE', productId: 'P1' },
    ]);
    const listing: any = {
      status: 'pending_removal',
      marketplaceData: { syncIssue: { blocked: true } },
      save: jest.fn().mockResolvedValue(undefined),
    };
    listingModel.findOne.mockResolvedValue(listing);

    await reconciler.runFor('M1');

    expect(repo.markResolved).toHaveBeenCalledWith('S1');
    expect(listing.marketplaceData.syncIssue).toBeUndefined();
    expect(listing.status).toBe('active');
    expect(listing.save).toHaveBeenCalled();
    expect(publisher.requestSync).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'P1', reason: 'moderation_resolved' }),
    );
  });

  it('keeps an open row that is still active (no resolve)', async () => {
    mlClient.getAllInfractions.mockResolvedValue([{ element_id: 'MLB1', filter_subgroup: 'DOMAIN' }]);
    repo.findAllOpen.mockResolvedValue([{ _id: 'S1', externalId: 'MLB1', productId: 'P1' }]);

    await reconciler.runFor('M1');

    expect(repo.markResolved).not.toHaveBeenCalled();
  });

  it('skips when the token has no userId', async () => {
    broker.ensureValidToken.mockResolvedValue({ accessToken: 'tok', additionalData: {} });

    await reconciler.runFor('M1');

    expect(mlClient.getAllInfractions).not.toHaveBeenCalled();
  });
});

import { ModerationReconciler } from './moderation-reconciler.service';

/**
 * Status-first design: /infractions is only used to discover candidate externalIds (it's a
 * historical log that never expires an entry, per ML's own docs). Every candidate — whether
 * currently in /infractions, already locally open, or both — gets its REAL current status
 * checked via getItemsModerationStatus before the reconciler decides to ingest or resolve.
 * No cap, no priority ordering: every run covers every candidate.
 */
describe('ModerationReconciler.runFor', () => {
  let listingModel: { findOne: jest.Mock };
  let registry: any;
  let broker: { ensureValidToken: jest.Mock; ensureValidTokenByAccount: jest.Mock };
  let mlClient: {
    getAllInfractions: jest.Mock;
    getLastModeration: jest.Mock;
    getItemCategoryId: jest.Mock;
    getItemsModerationStatus: jest.Mock;
  };
  let repo: { findAllOpen: jest.Mock; markResolved: jest.Mock };
  let ingest: { ingest: jest.Mock };
  let publisher: { requestSync: jest.Mock };
  let reconciler: ModerationReconciler;

  /** Default: every id checked comes back still-moderated, unless a test overrides it. */
  const statusMap = (ids: string[], entry: { status: string | null; subStatus: string[]; stillModerated: boolean }) =>
    new Map(ids.map((id) => [id, entry] as const));

  const STILL_MODERATED = { status: 'under_review', subStatus: ['waiting_for_patch'], stillModerated: true };
  const RESOLVED = { status: 'active', subStatus: [], stillModerated: false };

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
      getItemsModerationStatus: jest.fn().mockImplementation((ids: string[]) => Promise.resolve(statusMap(ids, STILL_MODERATED))),
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

  it('ingests each active infraction that is genuinely still moderated', async () => {
    mlClient.getAllInfractions.mockResolvedValue([
      { element_id: 'MLB1', filter_subgroup: 'DOMAIN' },
      { element_id: 'MLB2', filter_subgroup: 'COMPATS' },
    ]);

    await reconciler.runFor('M1');

    expect(ingest.ingest).toHaveBeenCalledTimes(2);
    // wrong-category resolves blocked category; compats does not
    expect(mlClient.getItemCategoryId).toHaveBeenCalledWith('MLB1', 'tok');
    expect(mlClient.getItemCategoryId).not.toHaveBeenCalledWith('MLB2', 'tok');
    // every candidate gets its real status checked in one batch call, brand-new or not
    expect(mlClient.getItemsModerationStatus).toHaveBeenCalledWith(expect.arrayContaining(['MLB1', 'MLB2']), 'tok');
  });

  it('does not ingest a brand-new /infractions entry whose item is already resolved on ML (no create-then-resolve churn)', async () => {
    mlClient.getAllInfractions.mockResolvedValue([{ element_id: 'MLB-STALE', filter_subgroup: 'COMPATS' }]);
    mlClient.getItemsModerationStatus.mockResolvedValue(statusMap(['MLB-STALE'], RESOLVED));
    repo.findAllOpen.mockResolvedValue([]); // no pre-existing row — /infractions is just stale history

    await reconciler.runFor('M1');

    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(repo.markResolved).not.toHaveBeenCalled(); // nothing to resolve — it was never opened
  });

  it('resolves an open row whose item is actually active again, even though /infractions still lists it', async () => {
    mlClient.getAllInfractions.mockResolvedValue([{ element_id: 'MLB1', filter_subgroup: 'COMPATS' }]);
    mlClient.getItemsModerationStatus.mockResolvedValue(statusMap(['MLB1'], RESOLVED));
    repo.findAllOpen.mockResolvedValue([{ _id: 'S1', externalId: 'MLB1', productId: 'P1' }]);
    const listing: any = {
      status: 'error',
      marketplaceData: { syncIssue: { blocked: true } },
      save: jest.fn().mockResolvedValue(undefined),
    };
    listingModel.findOne.mockResolvedValue(listing);

    await reconciler.runFor('M1');

    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(repo.markResolved).toHaveBeenCalledWith('S1');
    expect(listing.status).toBe('active');
  });

  it('resolves an open row that vanished from /infractions entirely (still checked via the union, not a special branch)', async () => {
    mlClient.getAllInfractions.mockResolvedValue([]); // nothing active now
    mlClient.getItemsModerationStatus.mockResolvedValue(statusMap(['MLB-GONE'], RESOLVED));
    repo.findAllOpen.mockResolvedValue([{ _id: 'S1', externalId: 'MLB-GONE', productId: 'P1' }]);
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

  it('keeps an open row that is still genuinely moderated (no resolve)', async () => {
    mlClient.getAllInfractions.mockResolvedValue([{ element_id: 'MLB1', filter_subgroup: 'DOMAIN' }]);
    repo.findAllOpen.mockResolvedValue([{ _id: 'S1', externalId: 'MLB1', productId: 'P1' }]);

    await reconciler.runFor('M1');

    expect(repo.markResolved).not.toHaveBeenCalled();
  });

  /**
   * The regression this redesign exists to prevent: resolving in run N must not make the same id
   * look "brand new" (and therefore un-checked / re-ingested) in run N+1, just because it's no
   * longer in findAllOpen's result. Every candidate is always checked, so there is no "new" branch
   * that can skip verification.
   */
  it('does not reopen a row resolved in a previous run when /infractions still lists it on the next run', async () => {
    mlClient.getAllInfractions.mockResolvedValue([{ element_id: 'MLB1', filter_subgroup: 'COMPATS' }]);
    mlClient.getItemsModerationStatus.mockResolvedValue(statusMap(['MLB1'], RESOLVED));
    repo.findAllOpen.mockResolvedValue([]); // run N already resolved it — no longer open

    await reconciler.runFor('M1');
    await reconciler.runFor('M1'); // run N+1, same /infractions listing, same real status

    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(repo.markResolved).not.toHaveBeenCalled();
  });

  it('checks every candidate id in one batch call regardless of account size (no per-run cap)', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `MLB${i}`);
    mlClient.getAllInfractions.mockResolvedValue(ids.map((id) => ({ element_id: id, filter_subgroup: 'COMPATS' })));
    repo.findAllOpen.mockResolvedValue(ids.map((id) => ({ _id: `S-${id}`, externalId: id, productId: 'P1' })));

    await reconciler.runFor('M1');

    const checked = new Set<string>();
    for (const call of mlClient.getItemsModerationStatus.mock.calls) {
      for (const id of call[0]) checked.add(id);
    }
    expect(checked.size).toBe(250);
  });

  it('skips when the token has no userId', async () => {
    broker.ensureValidToken.mockResolvedValue({ accessToken: 'tok', additionalData: {} });

    await reconciler.runFor('M1');

    expect(mlClient.getAllInfractions).not.toHaveBeenCalled();
  });
});

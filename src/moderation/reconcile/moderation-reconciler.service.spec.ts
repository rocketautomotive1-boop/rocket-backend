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
    getItemModerationStatus: jest.Mock;
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
      getItemModerationStatus: jest.fn().mockResolvedValue({ status: 'under_review', subStatus: ['waiting_for_patch'], stillModerated: true }),
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
    // brand-new infractions (no pre-existing open row) are still verified against /items — the
    // mock's default stillModerated:true means they proceed to ingest normally.
    expect(mlClient.getItemModerationStatus).toHaveBeenCalledWith('MLB1', 'tok');
    expect(mlClient.getItemModerationStatus).toHaveBeenCalledWith('MLB2', 'tok');
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

  /**
   * getItemModerationStatus costs one live GET /items/{id} per already-open row — and open-row
   * count scales with account size (seen live: 1600+), not with the once-a-day run cadence. Capping
   * how many open rows get re-checked per run bounds the burst; rows past the cap simply keep their
   * current state and get picked up on a later run (nothing is lost, just spread out).
   */
  it('caps how many already-open rows get the extra current-status check per run', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `MLB${i}`);
    mlClient.getAllInfractions.mockResolvedValue(ids.map((id) => ({ element_id: id, filter_subgroup: 'COMPATS' })));
    repo.findAllOpen.mockResolvedValue(ids.map((id) => ({ _id: `S-${id}`, externalId: id, productId: 'P1' })));

    await reconciler.runFor('M1', undefined, 3);

    expect(mlClient.getItemModerationStatus).toHaveBeenCalledTimes(3);
  });

  /**
   * The status-check order must follow findAllOpen's own ordering (oldest-updated first), NOT
   * /infractions' order. /infractions comes back sorted by date_created_desc (ML's own default) —
   * a large, mostly-static account has the same few thousand infractions at the front every single
   * run, so if the cap consumes toIngest's order directly, rows that happen to sort late in
   * /infractions never rotate into the cap and stay open forever even though they're genuinely
   * resolved on ML. Confirmed live: findAllOpen's updatedAt-asc sort alone did NOT fix this,
   * because the reconciler loop iterates toIngest, not openRows — this test locks the actual fix.
   */
  /**
   * A row resolved in an earlier run is no longer in findAllOpen's result (status != 'open'), so
   * it looks identical to a brand-new infraction on the next run — /infractions still lists it
   * (per ML's docs, it never drops entries), so without a status check on brand-new entries too,
   * the old bug reappears one level up: resolve → next run treats it as new → skips the check
   * (no openRow) → re-ingests → re-opens. Confirmed live: RCK_AUTOMOTIVE's resolved count actually
   * DROPPED between consecutive runs (357 -> 272) because previously-resolved rows were reopened.
   * The fix: check status for every toIngest entry, not just ones with a pre-existing open row —
   * and skip ingesting entirely (never create/reopen the row) when the item is already resolved.
   */
  it('does not re-ingest a brand-new /infractions entry whose item is already resolved on ML (no pre-existing open row)', async () => {
    mlClient.getAllInfractions.mockResolvedValue([{ element_id: 'MLB-STALE', filter_subgroup: 'COMPATS' }]);
    mlClient.getItemModerationStatus.mockResolvedValue({ status: 'active', subStatus: [], stillModerated: false });
    repo.findAllOpen.mockResolvedValue([]); // no pre-existing row — this looks brand new

    await reconciler.runFor('M1');

    expect(mlClient.getItemModerationStatus).toHaveBeenCalledWith('MLB-STALE', 'tok');
    expect(ingest.ingest).not.toHaveBeenCalled();
    expect(repo.markResolved).not.toHaveBeenCalled(); // nothing to resolve — it was never opened
  });

  it('checks the open rows findAllOpen returns first, ignoring /infractions ordering', async () => {
    // /infractions returns MLB-LATE before MLB-FIRST (its own date_created_desc order) — the
    // opposite of findAllOpen's oldest-updated-first order. The cap (1) must still pick MLB-FIRST.
    mlClient.getAllInfractions.mockResolvedValue([
      { element_id: 'MLB-LATE', filter_subgroup: 'COMPATS' },
      { element_id: 'MLB-FIRST', filter_subgroup: 'COMPATS' },
    ]);
    repo.findAllOpen.mockResolvedValue([
      { _id: 'S-FIRST', externalId: 'MLB-FIRST', productId: 'P1' },
      { _id: 'S-LATE', externalId: 'MLB-LATE', productId: 'P2' },
    ]);

    await reconciler.runFor('M1', undefined, 1);

    expect(mlClient.getItemModerationStatus).toHaveBeenCalledTimes(1);
    expect(mlClient.getItemModerationStatus).toHaveBeenCalledWith('MLB-FIRST', 'tok');
  });

  /**
   * /moderations/infractions is a historical log (per ML docs) — it never drops an entry just
   * because the item was fixed. So a row can be BOTH present in /infractions AND genuinely resolved
   * (item back to status=active, no pending sub_status). The reconciler must trust /items/{id}'s
   * current status over the historical infractions list, and resolve instead of re-ingesting.
   */
  it('resolves an open row whose item is actually active again, even though /infractions still lists it', async () => {
    mlClient.getAllInfractions.mockResolvedValue([{ element_id: 'MLB1', filter_subgroup: 'COMPATS' }]);
    mlClient.getItemModerationStatus.mockResolvedValue({ status: 'active', subStatus: [], stillModerated: false });
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

  it('skips when the token has no userId', async () => {
    broker.ensureValidToken.mockResolvedValue({ accessToken: 'tok', additionalData: {} });

    await reconciler.runFor('M1');

    expect(mlClient.getAllInfractions).not.toHaveBeenCalled();
  });
});

import { diffModerations } from './moderation-diff';

describe('diffModerations', () => {
  it('ingests every active infraction', () => {
    const { toIngest } = diffModerations({
      activeExternalIds: ['MLB1', 'MLB2'],
      openExternalIds: [],
    });
    expect(toIngest.sort()).toEqual(['MLB1', 'MLB2']);
  });

  it('resolves open rows that are no longer active (the divergence fix)', () => {
    const { toResolve } = diffModerations({
      activeExternalIds: ['MLB1'],
      openExternalIds: ['MLB1', 'MLB2', 'MLB3'],
    });
    expect(toResolve.sort()).toEqual(['MLB2', 'MLB3']);
  });

  it('nothing to resolve when all open rows are still active', () => {
    const { toResolve } = diffModerations({
      activeExternalIds: ['MLB1', 'MLB2'],
      openExternalIds: ['MLB1', 'MLB2'],
    });
    expect(toResolve).toEqual([]);
  });

  it('a freshly-active id is ingested even if not open yet', () => {
    const { toIngest, toResolve } = diffModerations({
      activeExternalIds: ['MLB9'],
      openExternalIds: [],
    });
    expect(toIngest).toEqual(['MLB9']);
    expect(toResolve).toEqual([]);
  });

  it('clean run: empty active + empty open → nothing', () => {
    expect(diffModerations({ activeExternalIds: [], openExternalIds: [] })).toEqual({
      toIngest: [],
      toResolve: [],
    });
  });
});

/**
 * Pure diff between the marketplace's currently-active infractions and our open moderation_state
 * rows. This is what the old polling never did: it only ever ADDED. Here we also compute which
 * local rows must be CLOSED because they vanished from /infractions (the marketplace resolved them).
 */

export interface DiffInput {
  /** externalIds with an active infraction right now (from /infractions). */
  activeExternalIds: string[];
  /** externalIds of our currently-open moderation_state rows. */
  openExternalIds: string[];
}

export interface DiffResult {
  /** Present at the marketplace → ingest (upsert open + run handler). */
  toIngest: string[];
  /** Open locally but gone from the marketplace → resolve. */
  toResolve: string[];
}

export function diffModerations(input: DiffInput): DiffResult {
  const active = new Set(input.activeExternalIds);
  const open = new Set(input.openExternalIds);

  return {
    toIngest: [...active],
    toResolve: [...open].filter((id) => !active.has(id)),
  };
}

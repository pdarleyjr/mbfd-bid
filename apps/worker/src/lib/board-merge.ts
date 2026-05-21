/**
 * Pure merge helpers for /api/board.
 *
 * The /api/board endpoint reads the in-memory snapshot from the BidSession DO
 * (the source of truth for in-flight bids) AND committed rows from the D1
 * `bids` table (the source of truth for durable picks). Several admin
 * codepaths — rehearsal auto-bid, /bid-for-member, /force-pick, /skip — write
 * straight to D1 without round-tripping through the DO, so the DO's `fills`
 * map stays empty in those scenarios. This helper merges the two so the
 * Admin Console reflects every pick that exists, regardless of which path
 * created it.
 *
 * D1 wins on conflict — committed bids are durable; the DO buffer is only
 * authoritative for in-progress submissions that haven't been persisted yet.
 */

export interface Fill {
  memberId: number;
  ordinal: number;
  bidId: string;
}

export interface DbBidRow {
  id: string;
  memberId: number;
  positionId: string;
  ordinal: number;
}

export function mergeFills(
  doFills: Record<string, Fill> | undefined,
  dbBidRows: ReadonlyArray<DbBidRow>,
): Record<string, Fill> {
  const merged: Record<string, Fill> = { ...(doFills ?? {}) };
  for (const b of dbBidRows) {
    merged[b.positionId] = { memberId: b.memberId, ordinal: b.ordinal, bidId: b.id };
  }
  return merged;
}

/**
 * Decide which `currentPhase` to expose to clients given the DO's snapshot
 * and the D1 session row. D1 wins when it has progressed past `config`,
 * because that means an admin codepath has advanced the session out-of-band
 * (e.g. rehearsal auto-bid bootstrap).
 */
export function resolvePhase(doPhase: unknown, d1Phase: string | null): string {
  if (d1Phase !== null && d1Phase !== 'config') return d1Phase;
  if (typeof doPhase === 'string') return doPhase;
  return d1Phase ?? 'config';
}

/**
 * Decide which `currentBidderId` to expose. D1 wins when it has a non-null
 * value — the same out-of-band-update rationale as `resolvePhase`.
 */
export function resolveCurrentBidderId(
  doCurrentBidderId: number | null | undefined,
  d1CurrentBidderId: number | null,
): number | null {
  if (d1CurrentBidderId !== null) return d1CurrentBidderId;
  if (typeof doCurrentBidderId === 'number') return doCurrentBidderId;
  return null;
}

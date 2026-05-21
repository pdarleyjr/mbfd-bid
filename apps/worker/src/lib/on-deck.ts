/**
 * Live Bid Console — compute the on-deck queue. Pure function, no I/O, so
 * tests can pin the behaviour without standing up a Durable Object.
 *
 * Skips members who have already been filled (defensive: under normal play
 * the cursor advances past filled entries, but the snapshot is the SoT and
 * may be transiently out-of-sync mid-pick).
 */

export const DEFAULT_ON_DECK_COUNT = 5;

export interface BidOrderEntry {
  ordinal: number;
  memberId: number;
  pool: 'OFC' | 'FF';
}

export function computeOnDeck(
  bidOrder: ReadonlyArray<BidOrderEntry>,
  currentBidderId: number | null,
  filledMemberIds: ReadonlySet<number>,
  count: number = DEFAULT_ON_DECK_COUNT,
): BidOrderEntry[] {
  if (bidOrder.length === 0) return [];
  const startIndex =
    currentBidderId === null
      ? 0
      : bidOrder.findIndex((entry) => entry.memberId === currentBidderId) + 1;
  // findIndex returns -1 when the current bidder isn't in bidOrder (e.g. an
  // admin-forced pick from outside Phase 1 ordering). +1 gives 0 — we still
  // surface the next 5 from the top of the queue.
  if (startIndex < 0) return [];
  const out: BidOrderEntry[] = [];
  for (let i = startIndex; i < bidOrder.length && out.length < count; i += 1) {
    const entry = bidOrder[i];
    if (entry === undefined) continue;
    if (filledMemberIds.has(entry.memberId)) continue;
    out.push(entry);
  }
  return out;
}

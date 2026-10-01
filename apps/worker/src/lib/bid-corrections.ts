import type { BidSessionState, LiveBidProgress } from '../durable/bid-session-state.js';

export type BidCorrection = NonNullable<LiveBidProgress['corrections']>[number];

export interface CorrectionSpecialtyRequest {
  specialtyId: string;
  positionId: string;
  requesterMemberId: number;
  candidateMemberIds: number[];
  requestCommandId: string;
}

/** Revocation is an explicit unresolved selection right, never a contact
 * disposition. Resolve only the exact latest revocation named by replacement. */
export function unresolvedBidCorrections(state: BidSessionState): BidCorrection[] {
  const corrections = state.live?.corrections ?? [];
  const resolved = new Set(corrections.map((entry) => entry.resolvesCorrectionBidId));
  return corrections.filter((entry) => entry.after === null && !resolved.has(entry.bidId));
}

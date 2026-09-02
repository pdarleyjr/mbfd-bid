import type { BidSessionState } from '../durable/bid-session-state.js';
import type { FutureRosterObservation } from './post-bid-transition.js';

export interface CanonicalAnnualCompletionSource {
  readonly session: {
    readonly id: string;
    readonly mode: 'REAL' | 'MOCK';
    readonly bidYear: number;
  };
  readonly completion: {
    readonly commandId: string;
    readonly revision: number;
    readonly completedAtMs: number;
    readonly receiptIntegrity: 'VERIFIED' | 'UNVERIFIED';
  };
  readonly frozen: {
    readonly ruleBookVersion: string;
    readonly topologyReference: string;
    readonly staffingReference: string | null;
    readonly members: readonly { readonly memberId: number; readonly rank: string | null }[];
    readonly positions: readonly {
      readonly id: string;
      readonly shift: string | null;
      readonly station: string | null;
      readonly unit: string | null;
      readonly position: string | null;
      readonly specialty: string | null;
    }[];
  };
  readonly state: BidSessionState;
  readonly amendmentLinks: readonly {
    readonly originalBidId: string;
    readonly replacementBidId: string;
  }[];
}

export interface CanonicalAnnualCompletionResult {
  readonly v: 1;
  readonly sessionId: string;
  readonly mode: 'REAL';
  readonly bidYear: number;
  readonly completion: {
    readonly completedAtMs: number;
    readonly revision: number;
    readonly commandId: string;
    readonly receiptIntegrity: 'VERIFIED';
  };
  readonly frozen: {
    readonly ruleBookVersion: string;
    readonly topologyReference: string;
    readonly staffingReference: string | null;
  };
  readonly participants: readonly {
    readonly memberId: number;
    readonly positionId: string;
    readonly rank: string | null;
    readonly shift: string | null;
    readonly station: string | null;
    readonly unit: string | null;
    readonly position: string | null;
    readonly aDay: string;
    readonly specialty: string | null;
    readonly amendment: {
      readonly originalBidId: string;
      readonly replacementBidId: string;
    } | null;
  }[];
  readonly unresolvedMemberIds: readonly number[];
  readonly futureRoster: readonly FutureRosterObservation[];
}

export type CanonicalAnnualCompletionProjection =
  | { readonly ok: true; readonly value: CanonicalAnnualCompletionResult }
  | {
      readonly ok: false;
      readonly code:
        | 'REAL_COMPLETION_REQUIRED'
        | 'ANNUAL_COMPLETION_REQUIRED'
        | 'COMPLETION_REVISION_MISMATCH'
        | 'COMPLETION_RECEIPT_UNVERIFIED'
        | 'UNRESOLVED_MEMBERS_BLOCK_TRANSITION'
        | 'FINAL_A_DAY_MISSING'
        | 'FINAL_A_DAY_DUPLICATE'
        | 'FINAL_A_DAY_MEMBER_MISMATCH'
        | 'FROZEN_POSITION_REFERENCE_MISSING'
        | 'DUPLICATE_FINAL_MEMBER';
      readonly unresolvedMemberIds: readonly number[];
    };

/**
 * Produces the only Post-Bid input allowed for a completed annual session.
 * It reads the canonical completion state rather than accepting browser data
 * or replaying legacy award rows. The immutable command receipt is supplied
 * by the D1 adapter and makes this projection independently verifiable.
 */
export function projectCanonicalAnnualCompletion(
  source: CanonicalAnnualCompletionSource,
): CanonicalAnnualCompletionProjection {
  const unresolvedMemberIds = source.state.annual?.unresolvedMemberIds ?? [];
  if (source.session.mode !== 'REAL')
    return { ok: false, code: 'REAL_COMPLETION_REQUIRED', unresolvedMemberIds };
  if (
    source.state.currentPhase !== 'complete' ||
    source.state.annual?.completion === null ||
    source.state.annual?.completion === undefined
  )
    return { ok: false, code: 'ANNUAL_COMPLETION_REQUIRED', unresolvedMemberIds };
  if (
    source.state.annual.completion.readyForFinalizationAtMs !== source.completion.completedAtMs ||
    source.state.lastSeq !== source.completion.revision
  )
    return { ok: false, code: 'COMPLETION_REVISION_MISMATCH', unresolvedMemberIds };
  if (source.completion.receiptIntegrity !== 'VERIFIED')
    return { ok: false, code: 'COMPLETION_RECEIPT_UNVERIFIED', unresolvedMemberIds };
  if (unresolvedMemberIds.length > 0)
    return { ok: false, code: 'UNRESOLVED_MEMBERS_BLOCK_TRANSITION', unresolvedMemberIds };

  const aDayState = source.state.aDay;
  if (aDayState === null) return { ok: false, code: 'FINAL_A_DAY_MISSING', unresolvedMemberIds };

  const aDayByMember = new Map<number, string>();
  for (const pick of aDayState.picks) {
    if (aDayByMember.has(pick.memberId))
      return { ok: false, code: 'FINAL_A_DAY_DUPLICATE', unresolvedMemberIds };
    aDayByMember.set(pick.memberId, pick.aDay);
  }

  const positions = new Map(source.frozen.positions.map((position) => [position.id, position]));
  const rankByMember = new Map(
    source.frozen.members.map((member) => [member.memberId, member.rank]),
  );
  const amendmentByReplacement = new Map(
    source.amendmentLinks.map((link) => [link.replacementBidId, link]),
  );
  const participantMemberIds = new Set<number>();
  const participants: CanonicalAnnualCompletionResult['participants'][number][] = [];
  const futureRoster: FutureRosterObservation[] = [];

  for (const [positionId, fill] of Object.entries(source.state.fills).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (participantMemberIds.has(fill.memberId))
      return { ok: false, code: 'DUPLICATE_FINAL_MEMBER', unresolvedMemberIds };
    const position = positions.get(positionId);
    if (position === undefined)
      return { ok: false, code: 'FROZEN_POSITION_REFERENCE_MISSING', unresolvedMemberIds };
    const aDay = aDayByMember.get(fill.memberId);
    if (aDay === undefined) return { ok: false, code: 'FINAL_A_DAY_MISSING', unresolvedMemberIds };
    participantMemberIds.add(fill.memberId);
    const amendment = amendmentByReplacement.get(fill.bidId) ?? null;
    participants.push({
      memberId: fill.memberId,
      positionId,
      rank: rankByMember.get(fill.memberId) ?? null,
      shift: position.shift,
      station: position.station,
      unit: position.unit,
      position: position.position,
      aDay,
      specialty: position.specialty,
      amendment,
    });
    futureRoster.push({
      memberId: fill.memberId,
      shift: position.shift,
      station: position.station,
      unit: position.unit,
      position: position.position,
      aDay,
    });
  }

  if (aDayByMember.size !== participantMemberIds.size)
    return { ok: false, code: 'FINAL_A_DAY_MEMBER_MISMATCH', unresolvedMemberIds };

  return {
    ok: true,
    value: {
      v: 1,
      sessionId: source.session.id,
      mode: 'REAL',
      bidYear: source.session.bidYear,
      completion: {
        ...source.completion,
        receiptIntegrity: 'VERIFIED',
      },
      frozen: source.frozen,
      participants,
      unresolvedMemberIds,
      futureRoster,
    },
  };
}

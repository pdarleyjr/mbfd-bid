import type { FrozenBidEligibilityMember } from '@mbfd/shared';

/**
 * The minimum member projection accepted by the advisory. Callers must obtain
 * it from the session's immutable V3 snapshot; this service deliberately has
 * no Department, D1, Durable Object, clock, or eligibility-rule dependency.
 */
export type FrozenSpecialtyCoverageMember = Pick<FrozenBidEligibilityMember, 'memberId' | 'pool'>;

/** One exact specialty opportunity in the frozen run, not an inferred staffing slot. */
export interface FrozenSpecialtyCoverageSeat {
  /** Stable opportunity identity. Each individual seat must have its own id. */
  readonly seatId: string;
  /** Frozen position identity used only to recognize a proposed specialty selection. */
  readonly positionId: string;
  /** Frozen specialty/rule identity used for simple per-group counters. */
  readonly ruleGroupId: string;
  /** Canonical frozen-run award state; filled seats never enter the remaining graph. */
  readonly filled: boolean;
}

/**
 * A caller-produced, frozen minimum-eligibility result. The service never
 * reads credentials or rules to create an edge, so missing edges stay absent.
 */
export interface FrozenSpecialtyCoverageEligibilityEdge {
  readonly seatId: string;
  readonly memberId: number;
}

export interface FrozenSpecialtyCoverageAdvisoryInput {
  /** Kept solely so Mock and Live callers share one typed boundary; it does not alter matching. */
  readonly mode: 'mock' | 'live';
  /** Immutable session members, projected from the frozen policy snapshot. */
  readonly frozenMembers: readonly FrozenSpecialtyCoverageMember[];
  /** Every frozen specialty seat, including already-filled seats. */
  readonly specialtySeats: readonly FrozenSpecialtyCoverageSeat[];
  /** Only frozen, evaluated eligibility edges may be passed here. */
  readonly frozenEligibilityEdges: readonly FrozenSpecialtyCoverageEligibilityEdge[];
  /** Members already assigned by canonical run events and therefore unavailable. */
  readonly assignedMemberIds: readonly number[];
  /** Optional read-only counterfactual for a current bidder's proposed selection. */
  readonly currentBidder?: {
    readonly memberId: number;
    readonly proposedPositionId: string;
  };
}

export type SpecialtyCoverageStatus = 'FEASIBLE' | 'AT_RISK' | 'SHORTAGE';

export interface SpecialtyCoverageMatch {
  readonly seatId: string;
  readonly memberId: number;
}

export interface SpecialtyCoverageRuleGroup {
  readonly ruleGroupId: string;
  readonly totalSeatCount: number;
  readonly filledSeatCount: number;
  readonly remainingSeatCount: number;
  /** Available, frozen members with an explicit edge to at least one remaining seat in this group. */
  readonly simpleEligibleMemberIds: readonly number[];
}

export interface SpecialtyCoverageCounterfactual {
  readonly maximumRemainingCoveredCount: number;
  readonly guaranteedUncoveredSeatCount: number;
  readonly unmatchedSeatIds: readonly string[];
}

export type CurrentBidderCoverageAdvisory =
  | { readonly kind: 'NO_CURRENT_BIDDER' }
  | {
      readonly kind: 'SPECIALTY_SELECTION';
      readonly memberId: number;
      readonly proposedPositionId: string;
    }
  | {
      readonly kind: 'NON_SPECIALTY_SELECTION_SAFE';
      readonly memberId: number;
      readonly proposedPositionId: string;
      readonly lostCoverageCount: 0;
      readonly afterSelection: SpecialtyCoverageCounterfactual;
    }
  | {
      readonly kind: 'NON_SPECIALTY_SELECTION_RISK';
      readonly memberId: number;
      readonly proposedPositionId: string;
      readonly lostCoverageCount: number;
      readonly afterSelection: SpecialtyCoverageCounterfactual;
    };

export interface FrozenSpecialtyCoverageAdvisory {
  readonly totalSpecialtySeatCount: number;
  readonly filledSpecialtySeatCount: number;
  readonly remainingSpecialtySeatCount: number;
  readonly maximumRemainingCoveredCount: number;
  readonly guaranteedUncoveredSeatCount: number;
  readonly status: SpecialtyCoverageStatus;
  readonly ruleGroups: readonly SpecialtyCoverageRuleGroup[];
  /** One deterministic maximum-cardinality matching for the remaining graph. */
  readonly matching: readonly SpecialtyCoverageMatch[];
  readonly unmatchedSeatIds: readonly string[];
  /** Removing any listed available frozen member reduces maximum coverage. */
  readonly criticalMemberIds: readonly number[];
  readonly currentBidderAdvisory: CurrentBidderCoverageAdvisory;
}

interface MatchingCalculation {
  readonly matching: readonly SpecialtyCoverageMatch[];
  readonly unmatchedSeatIds: readonly string[];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function requireUniqueMemberIds(members: readonly FrozenSpecialtyCoverageMember[]) {
  const memberIds = new Set<number>();
  for (const member of members) {
    if (memberIds.has(member.memberId))
      throw new Error('SPECIALTY_COVERAGE_DUPLICATE_FROZEN_MEMBER');
    memberIds.add(member.memberId);
  }
  return memberIds;
}

function requireUniqueSeats(seats: readonly FrozenSpecialtyCoverageSeat[]) {
  const seatsById = new Map<string, FrozenSpecialtyCoverageSeat>();
  for (const seat of seats) {
    if (seatsById.has(seat.seatId)) throw new Error('SPECIALTY_COVERAGE_DUPLICATE_SEAT');
    seatsById.set(seat.seatId, seat);
  }
  return seatsById;
}

/**
 * Computes a deterministic maximum-cardinality bipartite matching. Seats and
 * candidates are traversed in stable order; augmenting paths preserve maximum
 * cardinality when a greedy first edge would otherwise strand a later seat.
 */
function maximumMatching(input: {
  readonly remainingSeatIds: readonly string[];
  readonly candidateIdsBySeat: ReadonlyMap<string, readonly number[]>;
  readonly availableMemberIds: ReadonlySet<number>;
}): MatchingCalculation {
  const seatForMember = new Map<number, string>();
  const memberForSeat = new Map<string, number>();

  const assignSeat = (seatId: string, visitedMemberIds: Set<number>): boolean => {
    const candidateIds = input.candidateIdsBySeat.get(seatId) ?? [];
    for (const memberId of candidateIds) {
      if (!input.availableMemberIds.has(memberId) || visitedMemberIds.has(memberId)) continue;
      visitedMemberIds.add(memberId);
      const occupiedSeatId = seatForMember.get(memberId);
      if (occupiedSeatId === undefined || assignSeat(occupiedSeatId, visitedMemberIds)) {
        seatForMember.set(memberId, seatId);
        memberForSeat.set(seatId, memberId);
        return true;
      }
    }
    return false;
  };

  for (const seatId of input.remainingSeatIds) assignSeat(seatId, new Set<number>());
  const matching = input.remainingSeatIds.flatMap((seatId) => {
    const memberId = memberForSeat.get(seatId);
    return memberId === undefined ? [] : [{ seatId, memberId }];
  });
  const unmatchedSeatIds = input.remainingSeatIds.filter((seatId) => !memberForSeat.has(seatId));
  return { matching, unmatchedSeatIds };
}

function counterfactualFromMatching(
  matching: MatchingCalculation,
  remainingSeatCount: number,
): SpecialtyCoverageCounterfactual {
  return {
    maximumRemainingCoveredCount: matching.matching.length,
    guaranteedUncoveredSeatCount: remainingSeatCount - matching.matching.length,
    unmatchedSeatIds: matching.unmatchedSeatIds,
  };
}

/**
 * Produces a read-only specialty coverage advisory from a frozen run graph.
 *
 * The only eligibility relationships considered are `frozenEligibilityEdges`.
 * This function never accesses a mutable Department record, evaluates a rule,
 * writes an award, or changes force policy. Both Mock and Live use the exact
 * same calculation because `mode` is intentionally not a matching input.
 */
export function adviseFrozenSpecialtyCoverage(
  input: FrozenSpecialtyCoverageAdvisoryInput,
): FrozenSpecialtyCoverageAdvisory {
  const frozenMemberIds = requireUniqueMemberIds(input.frozenMembers);
  const seatsById = requireUniqueSeats(input.specialtySeats);
  const assignedMemberIds = new Set(input.assignedMemberIds);
  for (const memberId of assignedMemberIds) {
    if (!frozenMemberIds.has(memberId))
      throw new Error('SPECIALTY_COVERAGE_ASSIGNED_MEMBER_NOT_FROZEN');
  }

  for (const edge of input.frozenEligibilityEdges) {
    if (!seatsById.has(edge.seatId)) throw new Error('SPECIALTY_COVERAGE_EDGE_SEAT_NOT_FROZEN');
    if (!frozenMemberIds.has(edge.memberId))
      throw new Error('SPECIALTY_COVERAGE_EDGE_MEMBER_NOT_FROZEN');
  }

  const remainingSeats = [...input.specialtySeats]
    .filter((seat) => !seat.filled)
    .sort((left, right) => compareText(left.seatId, right.seatId));
  const remainingSeatIds = remainingSeats.map((seat) => seat.seatId);
  const availableMemberIds = new Set(
    input.frozenMembers
      .filter((member) => member.pool !== 'EXCLUDED' && !assignedMemberIds.has(member.memberId))
      .map((member) => member.memberId),
  );
  const remainingSeatIdSet = new Set(remainingSeatIds);
  const candidateIdSetsBySeat = new Map<string, Set<number>>(
    remainingSeatIds.map((seatId) => [seatId, new Set<number>()]),
  );
  for (const edge of input.frozenEligibilityEdges) {
    if (!remainingSeatIdSet.has(edge.seatId) || !availableMemberIds.has(edge.memberId)) continue;
    candidateIdSetsBySeat.get(edge.seatId)?.add(edge.memberId);
  }
  const candidateIdsBySeat = new Map<string, readonly number[]>(
    remainingSeatIds.map((seatId) => [
      seatId,
      [...(candidateIdSetsBySeat.get(seatId) ?? new Set<number>())].sort(compareNumber),
    ]),
  );

  const baselineMatching = maximumMatching({
    remainingSeatIds,
    candidateIdsBySeat,
    availableMemberIds,
  });
  const baseline = counterfactualFromMatching(baselineMatching, remainingSeatIds.length);
  const relevantMemberIds = [...new Set([...candidateIdsBySeat.values()].flat())].sort(
    compareNumber,
  );
  const criticalMemberIds = relevantMemberIds.filter((memberId) => {
    const membersWithoutCandidate = new Set(availableMemberIds);
    membersWithoutCandidate.delete(memberId);
    return (
      maximumMatching({
        remainingSeatIds,
        candidateIdsBySeat,
        availableMemberIds: membersWithoutCandidate,
      }).matching.length < baseline.maximumRemainingCoveredCount
    );
  });

  const groupSeatCounts = new Map<
    string,
    {
      totalSeatCount: number;
      filledSeatCount: number;
      remainingSeatCount: number;
      candidateIds: Set<number>;
    }
  >();
  for (const seat of input.specialtySeats) {
    const group = groupSeatCounts.get(seat.ruleGroupId) ?? {
      totalSeatCount: 0,
      filledSeatCount: 0,
      remainingSeatCount: 0,
      candidateIds: new Set<number>(),
    };
    group.totalSeatCount += 1;
    if (seat.filled) {
      group.filledSeatCount += 1;
    } else {
      group.remainingSeatCount += 1;
      for (const memberId of candidateIdsBySeat.get(seat.seatId) ?? [])
        group.candidateIds.add(memberId);
    }
    groupSeatCounts.set(seat.ruleGroupId, group);
  }
  const ruleGroups = [...groupSeatCounts.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([ruleGroupId, group]) => ({
      ruleGroupId,
      totalSeatCount: group.totalSeatCount,
      filledSeatCount: group.filledSeatCount,
      remainingSeatCount: group.remainingSeatCount,
      simpleEligibleMemberIds: [...group.candidateIds].sort(compareNumber),
    }));

  const currentBidder = input.currentBidder;
  let currentBidderAdvisory: CurrentBidderCoverageAdvisory = { kind: 'NO_CURRENT_BIDDER' };
  if (currentBidder !== undefined) {
    if (!availableMemberIds.has(currentBidder.memberId))
      throw new Error('SPECIALTY_COVERAGE_CURRENT_BIDDER_UNAVAILABLE');
    const specialtyPositionIds = new Set(input.specialtySeats.map((seat) => seat.positionId));
    if (specialtyPositionIds.has(currentBidder.proposedPositionId)) {
      currentBidderAdvisory = {
        kind: 'SPECIALTY_SELECTION',
        memberId: currentBidder.memberId,
        proposedPositionId: currentBidder.proposedPositionId,
      };
    } else {
      const membersAfterSelection = new Set(availableMemberIds);
      membersAfterSelection.delete(currentBidder.memberId);
      const afterSelection = counterfactualFromMatching(
        maximumMatching({
          remainingSeatIds,
          candidateIdsBySeat,
          availableMemberIds: membersAfterSelection,
        }),
        remainingSeatIds.length,
      );
      const lostCoverageCount =
        baseline.maximumRemainingCoveredCount - afterSelection.maximumRemainingCoveredCount;
      currentBidderAdvisory =
        lostCoverageCount > 0
          ? {
              kind: 'NON_SPECIALTY_SELECTION_RISK',
              memberId: currentBidder.memberId,
              proposedPositionId: currentBidder.proposedPositionId,
              lostCoverageCount,
              afterSelection,
            }
          : {
              kind: 'NON_SPECIALTY_SELECTION_SAFE',
              memberId: currentBidder.memberId,
              proposedPositionId: currentBidder.proposedPositionId,
              lostCoverageCount: 0,
              afterSelection,
            };
    }
  }

  const status: SpecialtyCoverageStatus =
    baseline.guaranteedUncoveredSeatCount > 0
      ? 'SHORTAGE'
      : criticalMemberIds.length > 0
        ? 'AT_RISK'
        : 'FEASIBLE';
  return {
    totalSpecialtySeatCount: input.specialtySeats.length,
    filledSpecialtySeatCount: input.specialtySeats.length - remainingSeatIds.length,
    remainingSpecialtySeatCount: remainingSeatIds.length,
    maximumRemainingCoveredCount: baseline.maximumRemainingCoveredCount,
    guaranteedUncoveredSeatCount: baseline.guaranteedUncoveredSeatCount,
    status,
    ruleGroups,
    matching: baselineMatching.matching,
    unmatchedSeatIds: baseline.unmatchedSeatIds,
    criticalMemberIds,
    currentBidderAdvisory,
  };
}

// packages/a-day/src/order.ts
import type { Member } from '@mbfd/eligibility';
import type { Phase2BidOrderStrategy, Shift } from './types.js';

export interface Phase2BidOrderInput {
  strategy: Phase2BidOrderStrategy;
  /** Phase 1's bid_order, in ordinal sequence. */
  phase1Order: readonly number[];
  /** Every non-vacant Phase 1 pick. */
  phase1Picks: ReadonlyArray<{ memberId: number; shift: Shift; positionId: string }>;
  /** Full member roster (for rsc_seniority / rank_seniority lookup). */
  members: readonly Member[];
  /** Members whose A-Day is pre-seeded out-of-band (Union President, etc.). */
  preSeededMemberIds: readonly number[];
}

const SHIFT_RANK: Record<Shift, number> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * Computes the Phase-2 bid order.
 *
 * Members included:
 *   - Have a Phase 1 pick recorded (vacancies/skipped members are excluded).
 *   - Are NOT in the pre-seeded list (UP and similar).
 *
 * Ordering:
 *   - phase_1_order: preserve the Phase 1 ordinal sequence (default).
 *   - by_shift_then_seniority: group by shift A/B/C/D, sort each by rsc_seniority
 *     then rank_seniority ascending.
 *
 * Pure function; deterministic given identical inputs.
 */
export function phase2BidOrder(input: Phase2BidOrderInput): number[] {
  const preSeeded = new Set(input.preSeededMemberIds);
  const phase1ByMember = new Map(input.phase1Picks.map((p) => [p.memberId, p]));
  const memberById = new Map(input.members.map((mem) => [Number(mem.employeeId), mem]));

  const eligibleIds = input.phase1Order.filter(
    (id) => phase1ByMember.has(id) && !preSeeded.has(id),
  );

  if (input.strategy === 'phase_1_order') {
    return eligibleIds;
  }

  // by_shift_then_seniority
  const withMeta = eligibleIds
    .map((id) => {
      const phase1 = phase1ByMember.get(id);
      const member = memberById.get(id);
      if (!phase1 || !member) return undefined;
      return {
        id,
        shift: phase1.shift,
        rsc: member.rscSeniority,
        rank: member.rankSeniority ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .filter((x): x is { id: number; shift: Shift; rsc: number; rank: number } => x !== undefined);

  withMeta.sort((a, b) => {
    if (SHIFT_RANK[a.shift] !== SHIFT_RANK[b.shift]) {
      return SHIFT_RANK[a.shift] - SHIFT_RANK[b.shift];
    }
    if (a.rsc !== b.rsc) return a.rsc - b.rsc;
    return a.rank - b.rank;
  });
  return withMeta.map((x) => x.id);
}

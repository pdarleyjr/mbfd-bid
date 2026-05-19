// packages/a-day/src/state.ts
import type { Member } from '@mbfd/eligibility';
import type {
  ADayGroupId,
  ADayPick,
  ADayState,
  GroupCapacityConfig,
  Shift,
  Weekday,
  WeekdayCapacityConfig,
} from './types.js';

export interface InitADayStateInput {
  /**
   * One entry per non-vacant Phase 1 pick. Vacant positions (e.g., A215) are
   * simply absent.
   */
  phase1Picks: ReadonlyArray<{ memberId: number; positionId: string; shift: Shift }>;
  /** Full member roster for the session. */
  members: readonly Member[];
  /**
   * Deterministic Phase-2 bid order (member ids). Computed by the caller via
   * `phase2BidOrder()` from order.ts.
   */
  bidOrder: readonly number[];
  /**
   * Optional pre-seeded picks (e.g., Union President assigned pre-bid).
   * These appear in picksByMember from the start; the cursor will skip
   * over them on advance.
   */
  preSeededPicks?: readonly ADayPick[];
  groupCaps: Readonly<
    Record<Exclude<Shift, 'D'>, Readonly<Record<ADayGroupId, GroupCapacityConfig>>>
  >;
  weekdayCaps: Readonly<Partial<Record<Weekday, WeekdayCapacityConfig>>>;
}

/**
 * Builds the initial Phase-2 ADayState. Pure: no I/O, no clock.
 */
export function initADayState(input: InitADayStateInput): ADayState {
  const membersById = new Map<number, Member>(input.members.map((m) => [Number(m.employeeId), m]));
  const phase1ByMember = new Map<number, { positionId: string; shift: Shift }>(
    input.phase1Picks.map((p) => [p.memberId, { positionId: p.positionId, shift: p.shift }]),
  );
  const picksByMember = new Map<number, ADayPick>();
  for (const pre of input.preSeededPicks ?? []) {
    picksByMember.set(pre.memberId, pre);
  }
  // Skip cursor past any pre-seeded members at the head of the bidOrder.
  let cursor = 0;
  while (cursor < input.bidOrder.length) {
    const id = input.bidOrder[cursor];
    if (id === undefined || !picksByMember.has(id)) break;
    cursor++;
  }
  return {
    groupCaps: input.groupCaps,
    weekdayCaps: input.weekdayCaps,
    picksByMember,
    bidOrder: input.bidOrder,
    cursor,
    phase1ByMember,
    membersById,
  };
}

/**
 * Returns a new state with the pick recorded and the cursor advanced past any
 * already-picked members (handles pre-seeded entries interleaved in bidOrder).
 *
 * Does NOT validate — call canPick() first. applyPick is a state transition,
 * not a guarded one.
 */
export function applyPick(state: ADayState, pick: ADayPick): ADayState {
  const picksByMember = new Map(state.picksByMember);
  picksByMember.set(pick.memberId, pick);

  let cursor = state.cursor;
  // Advance past the just-picked member, then skip any already-picked entries.
  while (cursor < state.bidOrder.length) {
    const id = state.bidOrder[cursor];
    if (id === undefined) break;
    if (picksByMember.has(id)) {
      cursor++;
    } else {
      break;
    }
  }
  return {
    ...state,
    picksByMember,
    cursor,
  };
}

/**
 * Returns the next member id to bid, or undefined if Phase 2 is complete.
 * Convenience function for the DO's turn-management code.
 */
export function nextBidder(state: ADayState): number | undefined {
  if (state.cursor >= state.bidOrder.length) return undefined;
  return state.bidOrder[state.cursor];
}

/**
 * Returns true if every member in bidOrder has a pick recorded.
 */
export function isPhase2Complete(state: ADayState): boolean {
  return state.cursor >= state.bidOrder.length;
}

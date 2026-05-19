// packages/a-day/src/types.ts
import type { Member, Rank } from '@mbfd/eligibility';

/** Combat group identifiers, used by A/B/C shifts. */
export type ADayGroupId = 'G1' | 'G2' | 'G3' | 'G4';

/** Day-of-week identifiers, used by D-shift. */
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

/** A single A-Day value: either a combat group (A/B/C) or a weekday (D). */
export type ADayValue = ADayGroupId | Weekday;

/** The four shifts in the bid. */
export type Shift = 'A' | 'B' | 'C' | 'D';

/** Capacity rules for one of the four combat groups on a single shift. */
export interface GroupCapacityConfig {
  /** Minimum members in the group at Phase 2 completion (default 18). */
  min: number;
  /** Maximum members in the group at any time (default 19). */
  max: number;
  /**
   * Exact officer count required at Phase 2 completion (default 5).
   * Enforced as exact-match, not a range.
   */
  officersRequired: number;
}

/** Capacity rules for one weekday on D-shift. Missing key = no cap. */
export interface WeekdayCapacityConfig {
  /** Maximum members on this weekday. Undefined means no cap. */
  max: number | undefined;
}

/** Live count of an A-Day slot. */
export interface CapacityMeter {
  /** Total members currently assigned to this A-Day. */
  total: number;
  /** Max permitted; undefined means uncapped (D-shift default). */
  max: number | undefined;
  /** Officers (DC/CPT/LT) currently assigned. */
  officers: number;
  /**
   * Exact officers required at completion.
   * Undefined for D-shift (no per-weekday officer rule).
   */
  officersRequired: number | undefined;
  /** True if total === max (i.e., cannot accept another pick). */
  isFull: boolean;
}

/**
 * Computed snapshot of how the officer invariant looks for a given (shift, group)
 * AFTER a hypothetical pick is applied. Used by canPick() to report dry-run results.
 */
export interface OfficerInvariantSnapshot {
  shift: Shift;
  group: ADayGroupId;
  /** Officers currently assigned to this group. */
  currentOfficers: number;
  /** Officers IF the candidate pick is applied. */
  projectedOfficers: number;
  /** Exact required (default 5). */
  required: number;
  /**
   * True if, after applying the pick AND considering the remaining bid order
   * (members yet to pick on this shift), the invariant CAN still be satisfied.
   */
  feasible: boolean;
  /** Human-readable explanation for the picker UI / admin log. */
  explanation: string;
}

/** One Phase-2 A-Day assignment. */
export interface ADayPick {
  /** Member primary key. */
  memberId: number;
  /** Member's Phase 1 shift (read from the Phase 1 pick). */
  shift: Shift;
  /** Selected A-Day value. */
  aDay: ADayValue;
  /** Server-supplied timestamp at pick time (ms since epoch). */
  pickedAtMs: number;
  /** True only when an admin used the force-a-day endpoint. */
  forced: boolean;
  /** Member id of the admin who forced this pick. Null for normal picks. */
  adminActorId: number | null;
}

/**
 * The pure-data Phase-2 state held by the DO. Constructed once at transition
 * via initADayState(); evolved by applyPick().
 */
export interface ADayState {
  /** Group capacities keyed by shift then group. */
  groupCaps: Readonly<
    Record<Exclude<Shift, 'D'>, Readonly<Record<ADayGroupId, GroupCapacityConfig>>>
  >;
  /** D-shift weekday caps; missing keys mean no cap. */
  weekdayCaps: Readonly<Partial<Record<Weekday, WeekdayCapacityConfig>>>;
  /**
   * All picks so far, keyed by member id for O(1) idempotency check.
   * memberId to ADayPick.
   */
  picksByMember: ReadonlyMap<number, ADayPick>;
  /** Phase-2 ordered list of member ids; cursor advances on each pick. */
  bidOrder: readonly number[];
  /** Index into bidOrder of the next member to pick. */
  cursor: number;
  /**
   * Phase 1 picks keyed by member id, used to look up shift and detect
   * vacant positions. Read-only snapshot.
   */
  phase1ByMember: ReadonlyMap<number, { positionId: string; shift: Shift }>;
  /**
   * Member roster keyed by id, used by the invariant checker to look up rank.
   */
  membersById: ReadonlyMap<number, Member>;
}

/** Machine-stable rejection codes for A-Day picks. */
export type PickRejectionCode =
  | 'NOT_YOUR_TURN'
  | 'PHASE_NOT_A_DAY_BID'
  | 'NO_PHASE_1_PICK'
  | 'ALREADY_PICKED'
  | 'GROUP_FULL'
  | 'WEEKDAY_FULL'
  | 'OFFICER_INVARIANT_VIOLATED'
  | 'INVALID_A_DAY_FOR_SHIFT'
  | 'UNKNOWN_MEMBER';

/**
 * Discriminated union returned by canPick(). The DO uses the `ok` flag to
 * decide whether to apply the pick or broadcast a REJECT.
 */
export type PickValidation =
  | {
      ok: true;
      /** Capacity meter for the picked A-Day AFTER the pick. */
      projectedMeter: CapacityMeter;
      /** Officer-invariant snapshot (omitted for D-shift). */
      officerSnapshot?: OfficerInvariantSnapshot;
    }
  | {
      ok: false;
      /** Machine-stable rejection code. */
      reasonCode: PickRejectionCode;
      /** Human-readable label for toast/audit. */
      reasonLabel: string;
      /** Optional structured detail (e.g., projected officers count). */
      detail?: Readonly<Record<string, string | number | boolean>>;
    };

/** Strategy for computing Phase 2 bid order. */
export type Phase2BidOrderStrategy = 'phase_1_order' | 'by_shift_then_seniority';

/** Re-export the eligibility Rank for convenience. */
export type { Rank };

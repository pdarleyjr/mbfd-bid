// packages/a-day/src/groups.ts
import type { ADayGroupId, GroupCapacityConfig, Rank, Shift, Weekday } from './types.js';

/** Canonical ordered list of combat groups, used for UI rendering and iteration. */
export const COMBAT_GROUPS: readonly ADayGroupId[] = Object.freeze<ADayGroupId[]>([
  'G1',
  'G2',
  'G3',
  'G4',
]);

/** Canonical ordered list of weekdays (ISO order: Monday first). */
export const WEEKDAYS: readonly Weekday[] = Object.freeze<Weekday[]>([
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
]);

/** Officer ranks (those that count toward the 5/group invariant). */
export const OFFICER_RANKS: readonly Rank[] = Object.freeze<Rank[]>(['DC', 'CPT', 'LT']);

/** Default capacity rule for a combat group: 18-19 members, exactly 5 officers. */
export const DEFAULT_GROUP_CAPACITY: GroupCapacityConfig = Object.freeze({
  min: 18,
  max: 19,
  officersRequired: 5,
});

/** Returns true if the given rank counts toward the officer invariant. */
export function isOfficer(rank: Rank): boolean {
  return OFFICER_RANKS.includes(rank);
}

/** Type guard: returns true if the value is a known combat group id. */
export function isCombatGroup(value: string): value is ADayGroupId {
  return (COMBAT_GROUPS as readonly string[]).includes(value);
}

/** Type guard: returns true if the value is a known weekday. */
export function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

/**
 * Returns true if the given A-Day value is structurally valid for the shift.
 * - A/B/C: must be a combat group id
 * - D: must be a weekday
 */
export function isValidADayForShift(shift: Shift, aDay: string): boolean {
  if (shift === 'D') return isWeekday(aDay);
  return isCombatGroup(aDay);
}

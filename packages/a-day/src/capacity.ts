// packages/a-day/src/capacity.ts
import { COMBAT_GROUPS, WEEKDAYS, isOfficer } from './groups.js';
import type { ADayGroupId, ADayState, CapacityMeter, Shift, Weekday } from './types.js';

/**
 * Returns the capacity meter for one (shift, aDay) pair.
 * - For A/B/C shifts: aDay must be one of G1..G4.
 * - For D shift: aDay must be a weekday; the cap is taken from state.weekdayCaps.
 *
 * Pure: does not mutate state.
 */
export function computeCapacityMeter(
  state: ADayState,
  shift: Shift,
  aDay: ADayGroupId | Weekday,
): CapacityMeter {
  let total = 0;
  let officers = 0;

  for (const pick of state.picksByMember.values()) {
    if (pick.shift !== shift) continue;
    if (pick.aDay !== aDay) continue;
    total++;
    const member = state.membersById.get(pick.memberId);
    if (member && isOfficer(member.rank)) {
      officers++;
    }
  }

  if (shift === 'D') {
    const weekdayCap = state.weekdayCaps[aDay as Weekday];
    const max = weekdayCap?.max;
    return {
      total,
      max,
      officers,
      officersRequired: undefined,
      isFull: max !== undefined && total >= max,
    };
  }

  // A / B / C
  const shiftCaps = state.groupCaps[shift as Exclude<Shift, 'D'>];
  const cap = shiftCaps[aDay as ADayGroupId];
  return {
    total,
    max: cap.max,
    officers,
    officersRequired: cap.officersRequired,
    isFull: total >= cap.max,
  };
}

/**
 * Returns true if the (shift, group) is at or above its max capacity.
 * Convenience wrapper over computeCapacityMeter for the common gate check.
 */
export function isGroupFull(
  state: ADayState,
  shift: Exclude<Shift, 'D'>,
  group: ADayGroupId,
): boolean {
  return computeCapacityMeter(state, shift, group).isFull;
}

/**
 * Returns all 12 A/B/C group meters plus all 7 weekday meters in one pass.
 * Used by the UI to render the full picker board and by the deterministic
 * advisory projection to summarize the returned capacity result.
 */
export function computeAllMeters(state: ADayState): {
  groups: Array<{ shift: Exclude<Shift, 'D'>; group: ADayGroupId; meter: CapacityMeter }>;
  weekdays: Array<{ weekday: Weekday; meter: CapacityMeter }>;
} {
  const groups: Array<{
    shift: Exclude<Shift, 'D'>;
    group: ADayGroupId;
    meter: CapacityMeter;
  }> = [];
  for (const shift of ['A', 'B', 'C'] as const) {
    for (const group of COMBAT_GROUPS) {
      groups.push({ shift, group, meter: computeCapacityMeter(state, shift, group) });
    }
  }
  const weekdays = WEEKDAYS.map((weekday) => ({
    weekday,
    meter: computeCapacityMeter(state, 'D', weekday),
  }));
  return { groups, weekdays };
}

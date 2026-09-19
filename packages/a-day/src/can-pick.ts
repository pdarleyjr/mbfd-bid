// packages/a-day/src/can-pick.ts
import { computeCapacityMeter } from './capacity.js';
import { isCombatGroup, isValidADayForShift } from './groups.js';
import { validateOfficerInvariant } from './officer-invariant.js';
import type {
  ADayGroupId,
  ADayState,
  ADayValue,
  CapacityMeter,
  PickValidation,
  Shift,
} from './types.js';

/**
 * Validates a candidate Phase-2 pick. Returns a discriminated union that the DO
 * uses to either apply the pick or broadcast a REJECT with structured detail.
 *
 * Order of checks matters — earlier rejections are cheaper and more informative:
 *   1. UNKNOWN_MEMBER (rare; programmer error)
 *   2. NO_PHASE_1_PICK (member never bid in Phase 1)
 *   3. ALREADY_PICKED (member already completed Phase 2)
 *   4. INVALID_A_DAY_FOR_SHIFT (UI bug or malicious client)
 *   5. GROUP_FULL / WEEKDAY_FULL (capacity)
 *   6. OFFICER_INVARIANT_VIOLATED (look-ahead)
 *
 * Note: NOT_YOUR_TURN and PHASE_NOT_A_DAY_BID are checked by the DO itself,
 * since they are session-level concerns that don't belong in this pure function.
 */
export function canPick(state: ADayState, memberId: number, aDay: ADayValue): PickValidation {
  const member = state.membersById.get(memberId);
  if (!member) {
    return {
      ok: false,
      reasonCode: 'UNKNOWN_MEMBER',
      reasonLabel: `Member ${memberId} not found in the bid session roster.`,
    };
  }

  const phase1 = state.phase1ByMember.get(memberId);
  if (!phase1) {
    return {
      ok: false,
      reasonCode: 'NO_PHASE_1_PICK',
      reasonLabel: `Member ${memberId} has no Phase 1 pick recorded; cannot pick A-Day until Phase 1 is complete for them.`,
    };
  }

  if (state.picksByMember.has(memberId)) {
    return {
      ok: false,
      reasonCode: 'ALREADY_PICKED',
      reasonLabel: `Member ${memberId} has already submitted a Phase 2 A-Day pick.`,
    };
  }

  const shift: Shift = phase1.shift;
  if (!isValidADayForShift(shift, aDay)) {
    return {
      ok: false,
      reasonCode: 'INVALID_A_DAY_FOR_SHIFT',
      reasonLabel:
        shift === 'D'
          ? `D-shift members must pick a weekday (MON-SUN); got "${aDay}".`
          : `${shift}-shift members must pick a combat group (G1-G4); got "${aDay}".`,
    };
  }

  // Capacity check
  const meter = computeCapacityMeter(state, shift, aDay);
  if (meter.max !== undefined && meter.total >= meter.max) {
    return {
      ok: false,
      reasonCode: shift === 'D' ? 'WEEKDAY_FULL' : 'GROUP_FULL',
      reasonLabel:
        shift === 'D'
          ? `Weekday ${aDay} on D-shift is full (${meter.total}/${meter.max}).`
          : `Group ${aDay} on ${shift}-shift is full (${meter.total}/${meter.max}).`,
      detail: { total: meter.total, max: meter.max },
    };
  }

  // Officer-invariant check (A/B/C only)
  for (const constraint of state.constraints ?? []) {
    if (constraint.shifts && !constraint.shifts.includes(shift)) continue;
    const matches = (id: number) => {
      const candidate = state.membersById.get(id);
      const assignment = state.phase1ByMember.get(id);
      return (
        constraint.memberIds.includes(id) ||
        (assignment !== undefined && constraint.positionIds.includes(assignment.positionId)) ||
        (candidate !== undefined && constraint.ranks.includes(candidate.rank))
      );
    };
    if (!matches(memberId)) continue;
    const count = [...state.picksByMember.values()].filter(
      (pick) => pick.shift === shift && pick.aDay === aDay && matches(pick.memberId),
    ).length;
    if (count >= constraint.maximum)
      return {
        ok: false,
        reasonCode: 'SCOPED_A_DAY_MAXIMUM',
        reasonLabel: `${constraint.label}: maximum ${constraint.maximum} on ${shift}-${aDay}.`,
        detail: {
          constraintId: constraint.id,
          sourceRef: constraint.sourceRef,
          count,
          maximum: constraint.maximum,
        },
      };
  }
  if (shift !== 'D' && isCombatGroup(aDay) && state.groupCaps[shift][aDay].officerMode !== 'NONE') {
    const snapshot = validateOfficerInvariant(state, shift, aDay as ADayGroupId, memberId);
    if (!snapshot.feasible) {
      return {
        ok: false,
        reasonCode: 'OFFICER_INVARIANT_VIOLATED',
        reasonLabel: snapshot.explanation,
        detail: {
          projectedOfficers: snapshot.projectedOfficers,
          required: snapshot.required,
        },
      };
    }
    // Projected meter post-pick
    const projectedMeter: CapacityMeter = {
      ...meter,
      total: meter.total + 1,
      officers: snapshot.projectedOfficers,
      isFull: meter.max !== undefined && meter.total + 1 >= meter.max,
    };
    return { ok: true, projectedMeter, officerSnapshot: snapshot };
  }

  // D-shift accept
  const projectedMeter: CapacityMeter = {
    ...meter,
    total: meter.total + 1,
    isFull: meter.max !== undefined && meter.total + 1 >= meter.max,
  };
  return { ok: true, projectedMeter };
}

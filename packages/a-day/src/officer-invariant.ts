// packages/a-day/src/officer-invariant.ts
import { COMBAT_GROUPS, isOfficer } from './groups.js';
import type { ADayGroupId, ADayState, OfficerInvariantSnapshot, Shift } from './types.js';

/**
 * Returns the projected officer count for (shift, group) if `candidateId`
 * picks that group. If the candidate's rank is not an officer rank, the count
 * is unchanged.
 */
export function projectedOfficers(
  state: ADayState,
  shift: Exclude<Shift, 'D'>,
  group: ADayGroupId,
  candidateId: number,
): number {
  let current = 0;
  for (const pick of state.picksByMember.values()) {
    if (pick.shift !== shift || pick.aDay !== group) continue;
    const member = state.membersById.get(pick.memberId);
    if (member && isOfficer(member.rank)) current++;
  }
  const candidate = state.membersById.get(candidateId);
  const candidateIsOfficer = candidate ? isOfficer(candidate.rank) : false;
  return candidateIsOfficer ? current + 1 : current;
}

/**
 * Per-group officer counts on a given shift, given a hypothetical pick by candidateId.
 * Used both for projection and for the feasibility look-ahead.
 */
function shiftOfficerCounts(
  state: ADayState,
  shift: Exclude<Shift, 'D'>,
  hypothetical?: { candidateId: number; group: ADayGroupId },
): Record<ADayGroupId, number> {
  const counts: Record<ADayGroupId, number> = { G1: 0, G2: 0, G3: 0, G4: 0 };
  for (const pick of state.picksByMember.values()) {
    if (pick.shift !== shift) continue;
    const g = pick.aDay as ADayGroupId;
    const member = state.membersById.get(pick.memberId);
    if (member && isOfficer(member.rank)) counts[g]++;
  }
  if (hypothetical) {
    const candidate = state.membersById.get(hypothetical.candidateId);
    if (candidate && isOfficer(candidate.rank)) {
      counts[hypothetical.group]++;
    }
  }
  return counts;
}

/**
 * Returns the number of officers still ahead in the bid order whose Phase 1 shift
 * equals `shift`, EXCLUDING the candidateId (since the candidate is being applied now).
 */
function remainingOfficersOnShift(
  state: ADayState,
  shift: Exclude<Shift, 'D'>,
  candidateId: number,
): number {
  let count = 0;
  for (let i = state.cursor; i < state.bidOrder.length; i++) {
    const id = state.bidOrder[i];
    if (id === undefined || id === candidateId) continue;
    const member = state.membersById.get(id);
    const phase1 = state.phase1ByMember.get(id);
    if (!member || !phase1) continue;
    if (phase1.shift !== shift) continue;
    if (isOfficer(member.rank)) count++;
  }
  return count;
}

/**
 * Validates that accepting a hypothetical pick for `candidateId` on
 * (shift, group) leaves the officer-per-group invariant satisfiable.
 *
 * Returns an OfficerInvariantSnapshot with `feasible` indicating whether
 * the invariant CAN still be met by completion of Phase 2.
 *
 * Two reasons for infeasibility:
 *   (a) Direct overflow — this pick would push the group above officersRequired.
 *   (b) Look-ahead shortfall — even after this pick, the sum of remaining
 *       officer shortfalls across all groups exceeds the number of officers
 *       still to bid on this shift.
 */
export function validateOfficerInvariant(
  state: ADayState,
  shift: Exclude<Shift, 'D'>,
  group: ADayGroupId,
  candidateId: number,
): OfficerInvariantSnapshot {
  const required = state.groupCaps[shift][group].officersRequired;
  const current = shiftOfficerCounts(state, shift)[group];
  const projected = projectedOfficers(state, shift, group, candidateId);

  // Case (a): direct overflow
  if (projected > required) {
    return {
      shift,
      group,
      currentOfficers: current,
      projectedOfficers: projected,
      required,
      feasible: false,
      explanation: `Pick exceeds the maximum of ${required} officers in ${shift}-shift ${group} (would be ${projected}).`,
    };
  }

  // Case (b): look-ahead feasibility
  const postCounts = shiftOfficerCounts(state, shift, { candidateId, group });
  const remaining = remainingOfficersOnShift(state, shift, candidateId);
  let shortfall = 0;
  for (const g of COMBAT_GROUPS) {
    const need = required - postCounts[g];
    if (need < 0) {
      return {
        shift,
        group,
        currentOfficers: current,
        projectedOfficers: projected,
        required,
        feasible: false,
        explanation: `Officer count in ${shift}-shift ${g} is already above ${required}.`,
      };
    }
    shortfall += need;
  }
  if (shortfall > remaining) {
    return {
      shift,
      group,
      currentOfficers: current,
      projectedOfficers: projected,
      required,
      feasible: false,
      explanation: `Accepting this pick leaves ${shortfall} officer slots to fill on ${shift}-shift but only ${remaining} officers remain in the bid order (insufficient officers remaining).`,
    };
  }

  return {
    shift,
    group,
    currentOfficers: current,
    projectedOfficers: projected,
    required,
    feasible: true,
    explanation: `Pick keeps ${shift}-shift ${group} at ${projected}/${required} officers; remaining bid order can still satisfy all groups.`,
  };
}

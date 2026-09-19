import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import type { BidSessionState } from '../durable/bid-session-state.js';

/** Validate overlays against the resulting canonical award set, including
 * amendments. No roster write, extra fill, or specialty-seat substitution. */
export function evaluateMembershipDistributions(
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>,
  state: BidSessionState,
  finalize: boolean,
): { ok: true } | { ok: false; code: string } {
  const policies =
    snapshot.settings.v === 3
      ? (snapshot.settings.livePolicy.annualOperations?.membershipDistributions ?? [])
      : [];
  const positions = new Map(snapshot.ruleBookMaterial.positions.map((p) => [p.id, p]));
  for (const policy of policies) {
    if (
      policy.memberIds.some(
        (id) =>
          !snapshot.members.some((member) => member.memberId === id && member.pool !== 'EXCLUDED'),
      )
    )
      return { ok: false, code: 'MEMBERSHIP_PARTICIPANT_EVIDENCE_REQUIRED' };
    const shifts = new Map<string, number>();
    const groups = new Map<string, number>();
    const assigned = new Set<number>();
    for (const [positionId, fill] of Object.entries(state.fills)) {
      if (!policy.memberIds.includes(fill.memberId)) continue;
      if (assigned.has(fill.memberId))
        return { ok: false, code: 'MEMBERSHIP_MULTIPLE_ASSIGNMENTS' };
      assigned.add(fill.memberId);
      const shift = positions.get(positionId)?.shift;
      if (!shift || shift === 'D' || !policy.shifts.includes(shift))
        return { ok: false, code: 'MEMBERSHIP_SHIFT_NOT_PERMITTED' };
      const total = (shifts.get(shift) ?? 0) + 1;
      if (total > policy.maximumPerShift)
        return { ok: false, code: 'MEMBERSHIP_SHIFT_MAXIMUM_REACHED' };
      shifts.set(shift, total);
      const aDay =
        fill.aDay ??
        state.aDay?.picks.find((p) => p.memberId === fill.memberId && p.shift === shift)?.aDay;
      if (!aDay) {
        if (finalize) return { ok: false, code: 'MEMBERSHIP_A_DAY_REQUIRED' };
        continue;
      }
      const key = `${shift}:${aDay}`;
      const groupTotal = (groups.get(key) ?? 0) + 1;
      if (groupTotal > policy.maximumPerADay)
        return { ok: false, code: 'MEMBERSHIP_A_DAY_MAXIMUM_REACHED' };
      groups.set(key, groupTotal);
    }
    if (finalize && assigned.size !== policy.memberIds.length)
      return { ok: false, code: 'MEMBERSHIP_ASSIGNMENTS_INCOMPLETE' };
    if (
      finalize &&
      policy.shifts.some((shift) => (shifts.get(shift) ?? 0) < policy.minimumPerShift)
    )
      return { ok: false, code: 'MEMBERSHIP_SHIFT_MINIMUM_NOT_MET' };
  }
  return { ok: true };
}

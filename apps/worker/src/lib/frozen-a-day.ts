import {
  type ADayScopedConstraint,
  type ADayState,
  type GroupCapacityConfig,
  applyPick,
  canPick,
  computeAllMeters,
  initADayState,
} from '@mbfd/a-day';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import { dehydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { evaluateMembershipDistributions } from './bid-membership-distribution.js';
import { eligibilityMemberFromFrozen } from './bid-policy.js';

/** Rebuild simultaneous A-Day allocation from canonical awards and frozen
 * policy, using the same pure engine as Phase 2 and the advisory projection. */
export function evaluateFrozenSimultaneousADays(
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>,
  state: BidSessionState,
  input: { nowMs: number; actorId: number; forced: boolean; finalize: boolean },
): { ok: true; aDay: BidSessionState['aDay'] } | { ok: false; code: string } {
  const membership = evaluateMembershipDistributions(snapshot, state, input.finalize);
  if (!membership.ok) return membership;
  const annual =
    snapshot.settings.v === 3 ? snapshot.settings.livePolicy.annualOperations : undefined;
  const execution = annual?.aDay.execution;
  if (!annual || !execution)
    return Object.values(state.fills).some((fill) => fill.aDay !== undefined)
      ? { ok: false, code: 'A_DAY_EXECUTION_POLICY_MISSING' }
      : { ok: true, aDay: state.aDay };
  if (execution.timing !== 'SIMULTANEOUS')
    return { ok: false, code: 'A_DAY_TIMING_WORKFLOW_UNAVAILABLE' };
  const positions = new Map(snapshot.ruleBookMaterial.positions.map((p) => [p.id, p]));
  const members = snapshot.members
    .filter((m) => m.pool !== 'EXCLUDED')
    .map((m) => ({
      ...eligibilityMemberFromFrozen(m),
      employeeId: String(m.memberId),
    }));
  const cap: GroupCapacityConfig = {
    min: annual.aDay.min,
    max: annual.aDay.max,
    officersRequired: execution.officersPerGroup ?? 0,
    officerMode: execution.officersPerGroup === null ? 'NONE' : 'EXACT',
  };
  const groups = { G1: cap, G2: cap, G3: cap, G4: cap };
  const constraints: ADayScopedConstraint[] = [
    ...execution.constraints,
    {
      id: 'captain-division-chief-limit',
      label: 'Captain and Division Chief limit',
      sourceRef: execution.sourceRef,
      maximum: annual.aDay.captainDcMax,
      positionIds: [],
      memberIds: [],
      ranks: ['CPT', 'DC'],
      shifts: ['A', 'B', 'C'],
    },
  ];
  const phase1Picks = [];
  const seen = new Set<number>();
  for (const [positionId, fill] of Object.entries(state.fills)) {
    const position = positions.get(positionId);
    if (!position || seen.has(fill.memberId))
      return { ok: false, code: 'A_DAY_ASSIGNMENT_INVALID' };
    if (fill.aDay === undefined) return { ok: false, code: 'A_DAY_REQUIRED_WITH_SELECTION' };
    seen.add(fill.memberId);
    phase1Picks.push({ positionId, memberId: fill.memberId, shift: position.shift });
  }
  let engine: ADayState = initADayState({
    members,
    phase1Picks,
    bidOrder: [...seen].sort((a, b) => a - b),
    groupCaps: { A: groups, B: groups, C: groups },
    weekdayCaps: {},
    constraints,
    allocationIncomplete: true,
  });
  for (const assignment of phase1Picks) {
    const fill = state.fills[assignment.positionId];
    if (!fill?.aDay) return { ok: false, code: 'A_DAY_REQUIRED_WITH_SELECTION' };
    const validation = canPick(engine, fill.memberId, fill.aDay);
    if (!validation.ok) return { ok: false, code: validation.reasonCode };
    const prior = state.aDay?.picks.find(
      (p) => p.memberId === fill.memberId && p.shift === assignment.shift && p.aDay === fill.aDay,
    );
    engine = applyPick(
      engine,
      prior ?? {
        memberId: fill.memberId,
        shift: assignment.shift,
        aDay: fill.aDay,
        pickedAtMs: input.nowMs,
        forced: input.forced,
        adminActorId: input.actorId,
      },
    );
  }
  if (input.finalize) {
    for (const entry of computeAllMeters(engine).groups) {
      if (entry.meter.total < annual.aDay.min) return { ok: false, code: 'A_DAY_MINIMUM_NOT_MET' };
      if (
        execution.officersPerGroup !== null &&
        entry.meter.officers !== execution.officersPerGroup
      )
        return { ok: false, code: 'A_DAY_OFFICER_TOTAL_NOT_MET' };
    }
  }
  return { ok: true, aDay: dehydrateADayState(engine) };
}

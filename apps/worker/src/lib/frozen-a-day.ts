import {
  type ADayPick,
  type ADayScopedConstraint,
  type ADayState,
  type GroupCapacityConfig,
  applyPick,
  canPick,
  computeAllMeters,
  initADayState,
  nextBidder,
  phase2BidOrder,
} from '@mbfd/a-day';
import type { BidSessionPolicySnapshot, FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import { dehydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { evaluateMembershipDistributions } from './bid-membership-distribution.js';
import { eligibilityMemberFromFrozen } from './bid-policy.js';

type FrozenADayEvaluation =
  | {
      ok: true;
      aDay: BidSessionState['aDay'];
      hasDeferredSelections: boolean;
      nextDeferredMemberId: number | null;
    }
  | { ok: false; code: string };

type FrozenADayEvaluationInput = {
  nowMs: number;
  actorId: number;
  forced: boolean;
  finalize: boolean;
};

function timingForPosition(
  execution: NonNullable<FrozenAnnualOperationsPolicy['aDay']['execution']>,
  positionId: string,
): { ok: true; timing: 'SIMULTANEOUS' | 'AFTER_POSITION_SELECTION' } | { ok: false } {
  const matching = (execution.timingExceptions ?? []).filter((entry) =>
    entry.positionIds.includes(positionId),
  );
  if (matching.length > 1) return { ok: false };
  return { ok: true, timing: matching[0]?.timing ?? execution.timing };
}

function samePick(left: ADayPick, right: ADayPick) {
  return left.memberId === right.memberId && left.shift === right.shift && left.aDay === right.aDay;
}

/**
 * Compile frozen position awards and frozen A-Day timing policy into the one
 * pure A-Day engine. Simultaneous assignments are pre-seeded; a Timeline
 * exception enters that same engine only after position selection completes.
 * No timing branch creates a second authority or bypasses capacity rules.
 */
export function evaluateFrozenADays(
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>,
  state: BidSessionState,
  input: FrozenADayEvaluationInput,
): FrozenADayEvaluation {
  const membership = evaluateMembershipDistributions(snapshot, state, input.finalize);
  if (!membership.ok) return membership;
  const annual =
    snapshot.settings.v === 3 ? snapshot.settings.livePolicy.annualOperations : undefined;
  const execution = annual?.aDay.execution;
  if (!annual || !execution)
    return Object.values(state.fills).some((fill) => fill.aDay !== undefined)
      ? { ok: false, code: 'A_DAY_EXECUTION_POLICY_MISSING' }
      : {
          ok: true,
          aDay: state.aDay,
          hasDeferredSelections: false,
          nextDeferredMemberId: null,
        };
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
  const unavailableCap: GroupCapacityConfig = {
    min: 0,
    max: 0,
    officersRequired: 0,
    officerMode: 'NONE',
  };
  const availableGroups = new Set(annual.aDay.combatGroups);
  const groups = {
    G1: availableGroups.has('G1') ? cap : unavailableCap,
    G2: availableGroups.has('G2') ? cap : unavailableCap,
    G3: availableGroups.has('G3') ? cap : unavailableCap,
    G4: availableGroups.has('G4') ? cap : unavailableCap,
  };
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
  const phase1Picks: { positionId: string; memberId: number; shift: 'A' | 'B' | 'C' | 'D' }[] = [];
  const simultaneousPicks: ADayPick[] = [];
  const deferredMemberIds = new Set<number>();
  const seen = new Set<number>();
  for (const [positionId, fill] of Object.entries(state.fills)) {
    const position = positions.get(positionId);
    if (!position || seen.has(fill.memberId))
      return { ok: false, code: 'A_DAY_ASSIGNMENT_INVALID' };
    const timing = timingForPosition(execution, positionId);
    if (!timing.ok) return { ok: false, code: 'A_DAY_TIMING_EXCEPTION_CONFLICT' };
    const selectedADay = fill.aDay;
    if (timing.timing === 'SIMULTANEOUS' && selectedADay === undefined)
      return { ok: false, code: 'A_DAY_REQUIRED_WITH_SELECTION' };
    if (timing.timing === 'AFTER_POSITION_SELECTION' && selectedADay !== undefined)
      return { ok: false, code: 'A_DAY_DEFERRED_SELECTION_REQUIRED' };
    seen.add(fill.memberId);
    phase1Picks.push({ positionId, memberId: fill.memberId, shift: position.shift });
    if (timing.timing === 'AFTER_POSITION_SELECTION') deferredMemberIds.add(fill.memberId);
    else {
      if (selectedADay === undefined) return { ok: false, code: 'A_DAY_REQUIRED_WITH_SELECTION' };
      const next: ADayPick = {
        memberId: fill.memberId,
        shift: position.shift,
        aDay: selectedADay,
        pickedAtMs: input.nowMs,
        forced: input.forced,
        adminActorId: input.actorId,
      };
      const prior = state.aDay?.picks.find((pick) => samePick(pick, next));
      simultaneousPicks.push(prior ?? next);
    }
  }
  const phase1Order = state.bidOrder.map((entry) => entry.memberId);
  const phase2Order = phase2BidOrder({
    strategy: 'phase_1_order',
    phase1Order,
    phase1Picks,
    members,
    preSeededMemberIds: simultaneousPicks.map((pick) => pick.memberId),
  });
  let engine: ADayState = initADayState({
    members,
    phase1Picks,
    bidOrder: phase2Order,
    groupCaps: { A: groups, B: groups, C: groups },
    weekdayCaps: {},
    constraints,
    allocationIncomplete: state.currentPhase !== 'complete',
  });
  // Validate and apply simultaneous picks before replaying delayed canonical
  // picks. This keeps both timing paths under the exact same capacity and
  // scoped-constraint engine.
  for (const pick of simultaneousPicks) {
    const validation = canPick(engine, pick.memberId, pick.aDay);
    if (!validation.ok) return { ok: false, code: validation.reasonCode };
    engine = applyPick(engine, pick);
  }
  // Replay only delayed canonical picks, in canonical cursor order, so restart
  // reconstruction cannot be influenced by client ordering or React state.
  const persistedDeferred = (state.aDay?.picks ?? [])
    .filter((pick) => deferredMemberIds.has(pick.memberId))
    .sort(
      (left, right) => phase2Order.indexOf(left.memberId) - phase2Order.indexOf(right.memberId),
    );
  for (const pick of persistedDeferred) {
    if (nextBidder(engine) !== pick.memberId)
      return { ok: false, code: 'A_DAY_PERSISTED_ORDER_INVALID' };
    const validation = canPick(engine, pick.memberId, pick.aDay);
    if (!validation.ok) return { ok: false, code: validation.reasonCode };
    engine = applyPick(engine, pick);
  }
  const nextDeferredMemberId = nextBidder(engine) ?? null;
  if (input.finalize) {
    if (nextDeferredMemberId !== null)
      return { ok: false, code: 'A_DAY_DEFERRED_SELECTION_INCOMPLETE' };
    for (const entry of computeAllMeters(engine).groups) {
      if (entry.meter.total < annual.aDay.min) return { ok: false, code: 'A_DAY_MINIMUM_NOT_MET' };
      if (
        execution.officersPerGroup !== null &&
        entry.meter.officers !== execution.officersPerGroup
      )
        return { ok: false, code: 'A_DAY_OFFICER_TOTAL_NOT_MET' };
    }
  }
  return {
    ok: true,
    aDay: dehydrateADayState(engine),
    hasDeferredSelections: deferredMemberIds.size > 0,
    nextDeferredMemberId,
  };
}

/**
 * Backwards-compatible narrow adapter used by historical simultaneous tests
 * and callers. New canonical commands use evaluateFrozenADays() so delayed
 * Timeline exceptions never fall through into simultaneous execution.
 */
export function evaluateFrozenSimultaneousADays(
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>,
  state: BidSessionState,
  input: FrozenADayEvaluationInput,
): { ok: true; aDay: BidSessionState['aDay'] } | { ok: false; code: string } {
  const execution =
    snapshot.settings.v === 3
      ? snapshot.settings.livePolicy.annualOperations?.aDay.execution
      : undefined;
  if (
    execution !== undefined &&
    (execution.timing !== 'SIMULTANEOUS' ||
      (execution.timingExceptions ?? []).some((exception) => exception.timing !== 'SIMULTANEOUS'))
  )
    return { ok: false, code: 'A_DAY_TIMING_WORKFLOW_UNAVAILABLE' };
  const evaluated = evaluateFrozenADays(snapshot, state, input);
  return evaluated.ok ? { ok: true, aDay: evaluated.aDay } : evaluated;
}

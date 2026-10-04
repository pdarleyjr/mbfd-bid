import {
  type ADayPick,
  type ADayScopedConstraint,
  type ADayState,
  type GroupCapacityConfig,
  applyPick,
  canPick,
  computeAllMeters,
  computeCapacityMeter,
  initADayState,
  isOfficer,
  nextBidder,
  phase2BidOrder,
} from '@mbfd/a-day';
import type { BidSessionPolicySnapshot, FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import { dehydrateADayState } from '../durable/bid-session-aday-handlers.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { type AdminBidOverrideWarning, addAdminBidOverrideWarning } from './admin-bid-override.js';
import { evaluateMembershipDistributions } from './bid-membership-distribution.js';
import { eligibilityMemberFromFrozen } from './bid-policy.js';

type FrozenADayEvaluation =
  | {
      ok: true;
      aDay: BidSessionState['aDay'];
      hasDeferredSelections: boolean;
      nextDeferredMemberId: number | null;
      overrideWarnings?: AdminBidOverrideWarning[];
    }
  | { ok: false; code: string };

type FrozenADayEvaluationInput = {
  nowMs: number;
  actorId: number;
  forced: boolean;
  finalize: boolean;
  /** Supplied by the authenticated canonical boundary for one reviewed pick. */
  adminOverrideMemberId?: number;
  /** Current proposed pick is replayed after the full prior accepted state,
   * including previously approved excesses, so ordinary commands stay strict. */
  selectionMemberId?: number;
};

export function frozenADayConstraints(
  annual: FrozenAnnualOperationsPolicy,
): ADayScopedConstraint[] {
  const execution = annual.aDay.execution;
  if (!execution) return [];
  return [
    ...execution.constraints,
    ...(annual.aDay.captainDcMax === null
      ? []
      : ([
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
        ] satisfies ADayScopedConstraint[])),
  ];
}

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
 * pure A-Day engine. Awards carrying an A-Day are pre-seeded; an early award
 * under a Timeline exception carries none and enters the same engine when its
 * ordinary turn (or, failing that, the post-position phase) records it.
 * Only explicit canonical administrator overrides may depart from business
 * capacities; normal picks and structural group/identity validation stay strict.
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
    min: annual.aDay.min ?? 0,
    max: annual.aDay.max ?? Math.max(1, members.length),
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
  const overrideWarnings: AdminBidOverrideWarning[] = [];
  const groups = {
    G1: availableGroups.has('G1') ? cap : unavailableCap,
    G2: availableGroups.has('G2') ? cap : unavailableCap,
    G3: availableGroups.has('G3') ? cap : unavailableCap,
    G4: availableGroups.has('G4') ? cap : unavailableCap,
  };
  const constraints = frozenADayConstraints(annual);
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
    const deferredApproval = fill.aDayDeferral;
    // Authorization is recorded in the actor/command identity. The optional
    // human note must not invalidate that approval when the award is replayed.
    const approvedDeferral =
      deferredApproval !== undefined &&
      deferredApproval.positionId === positionId &&
      deferredApproval.commandId.length > 0 &&
      deferredApproval.actorMemberId > 0 &&
      deferredApproval.reason.length <= 500;
    if (timing.timing === 'SIMULTANEOUS' && selectedADay === undefined && !approvedDeferral)
      return { ok: false, code: 'A_DAY_REQUIRED_WITH_SELECTION' };
    seen.add(fill.memberId);
    phase1Picks.push({ positionId, memberId: fill.memberId, shift: position.shift });
    if (selectedADay === undefined) deferredMemberIds.add(fill.memberId);
    else {
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
  const approvedCapacityDeparture = (pick: ADayPick) => {
    const award = Object.entries(state.fills).find(
      ([, candidate]) => candidate.memberId === pick.memberId,
    );
    const approval = award?.[1].aDayOverride;
    return (
      approval !== undefined &&
      approval.positionId === award?.[0] &&
      approval.aDay === pick.aDay &&
      approval.commandId.length > 0 &&
      approval.actorMemberId > 0 &&
      approval.reason.length <= 500 &&
      approval.warningCodes.some((code) => code.startsWith('A_DAY_POLICY_DEVIATION'))
    );
  };
  const applyReviewedPick = (pick: ADayPick): { ok: true } | { ok: false; code: string } => {
    const currentOverride = input.adminOverrideMemberId === pick.memberId;
    if (
      pick.shift !== 'D' &&
      pick.aDay.startsWith('G') &&
      !availableGroups.has(pick.aDay as 'G1' | 'G2' | 'G3' | 'G4')
    ) {
      if (!currentOverride && !approvedCapacityDeparture(pick))
        return { ok: false, code: 'GROUP_FULL' };
      if (currentOverride)
        addAdminBidOverrideWarning(
          overrideWarnings,
          'A_DAY_POLICY_DEVIATION:GROUP_NOT_ENABLED',
          `The administrator selects ${pick.aDay}, outside the frozen enabled groups. The source configuration remains unchanged.`,
        );
    }
    const validation = canPick(engine, pick.memberId, pick.aDay);
    if (!validation.ok) {
      const businessRule = [
        'GROUP_FULL',
        'WEEKDAY_FULL',
        'SCOPED_A_DAY_MAXIMUM',
        'OFFICER_INVARIANT_VIOLATED',
      ].includes(validation.reasonCode);
      if (!businessRule || (!currentOverride && !approvedCapacityDeparture(pick)))
        return { ok: false, code: validation.reasonCode };
      if (currentOverride)
        addAdminBidOverrideWarning(
          overrideWarnings,
          `A_DAY_POLICY_DEVIATION:${validation.reasonCode}`,
          `${validation.reasonLabel} The administrator is explicitly overriding this frozen A-Day staffing rule.`,
        );
    }
    if (
      input.adminOverrideMemberId === pick.memberId &&
      pick.shift !== 'D' &&
      execution.officersPerGroup !== null
    ) {
      const currentOfficers = computeCapacityMeter(engine, pick.shift, pick.aDay).officers;
      const member = engine.membersById.get(pick.memberId);
      const projectedOfficers =
        currentOfficers + Number(member !== undefined && isOfficer(member.rank));
      if (projectedOfficers > execution.officersPerGroup)
        addAdminBidOverrideWarning(
          overrideWarnings,
          'A_DAY_POLICY_DEVIATION:OFFICER_INVARIANT_VIOLATED',
          `${pick.shift}-${pick.aDay} officers exceed the frozen total (${projectedOfficers}/${execution.officersPerGroup}). The administrator is explicitly approving the excess.`,
        );
    }
    engine = applyPick(engine, pick);
    return { ok: true };
  };
  // Rebuild ordinary accepted picks before acknowledged departures. Object
  // property ordering after a correction must not transfer the excess to an
  // unrelated ordinary member or invalidate their earlier valid pick.
  // Replay delayed canonical picks in the order the sequenced queue accepted
  // them; restart reconstruction never depends on client ordering.
  const phase2Index = (memberId: number) => phase2Order.indexOf(memberId);
  const persistedDeferred = (state.aDay?.picks ?? [])
    .filter((pick) => deferredMemberIds.has(pick.memberId))
    .sort(
      (left, right) =>
        left.pickedAtMs - right.pickedAtMs ||
        phase2Index(left.memberId) - phase2Index(right.memberId),
    );
  const replayPicks = [...simultaneousPicks, ...persistedDeferred].sort(
    (left, right) =>
      (input.selectionMemberId === left.memberId ? 2 : Number(approvedCapacityDeparture(left))) -
        (input.selectionMemberId === right.memberId
          ? 2
          : Number(approvedCapacityDeparture(right))) || left.pickedAtMs - right.pickedAtMs,
  );
  for (const pick of replayPicks) {
    const applied = applyReviewedPick(pick);
    if (!applied.ok) return applied;
  }
  const nextDeferredMemberId = nextBidder(engine) ?? null;
  if (input.finalize) {
    if (nextDeferredMemberId !== null)
      return { ok: false, code: 'A_DAY_DEFERRED_SELECTION_INCOMPLETE' };
    for (const entry of computeAllMeters(engine).groups) {
      if (annual.aDay.min !== null && entry.meter.total < annual.aDay.min)
        return { ok: false, code: 'A_DAY_MINIMUM_NOT_MET' };
      if (
        execution.officersPerGroup !== null &&
        entry.meter.officers !== execution.officersPerGroup
      ) {
        const excess = entry.meter.officers - execution.officersPerGroup;
        const approvedExcess = [...engine.picksByMember.values()].filter((pick) => {
          const member = engine.membersById.get(pick.memberId);
          const fill = Object.values(state.fills).find(
            (candidate) => candidate.memberId === pick.memberId,
          );
          return (
            pick.shift === entry.shift &&
            pick.aDay === entry.group &&
            member !== undefined &&
            isOfficer(member.rank) &&
            approvedCapacityDeparture(pick) &&
            fill?.aDayOverride?.warningCodes.includes(
              'A_DAY_POLICY_DEVIATION:OFFICER_INVARIANT_VIOLATED',
            )
          );
        }).length;
        if (excess <= 0 || approvedExcess < excess)
          return { ok: false, code: 'A_DAY_OFFICER_TOTAL_NOT_MET' };
      }
    }
  }
  return {
    ok: true,
    aDay: dehydrateADayState(engine),
    hasDeferredSelections: deferredMemberIds.size > 0,
    nextDeferredMemberId,
    overrideWarnings,
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

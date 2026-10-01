import { type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot, FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { eligibilityMemberFromFrozen } from './bid-policy.js';

type Fallback = NonNullable<FrozenAnnualOperationsPolicy['fallbackPolicies']>[number];
type Activation = NonNullable<Fallback['activation']>;
type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;

function combatPositions(...suffixes: string[]): string[] {
  return ['A', 'B', 'C'].flatMap((shift) => suffixes.map((suffix) => `${shift}${suffix}`));
}

/** Reviewed Version11 source scopes, not the currently displayed catalog. */
const july2026PositionScopes: Readonly<Record<string, readonly string[]>> = {
  'fallback-captain5': combatPositions('212'),
  'fallback-designated-de': combatPositions('103', '104', '202', '303', '304', '402', '707', '708'),
  'fallback-fire-investigator': combatPositions('305'),
  'fallback-main-airtech': combatPositions('203'),
  'fallback-marine-deckhand': combatPositions('604'),
  'fallback-marine-engineer': combatPositions('603'),
  'fallback-marine-float': combatPositions('605', '606'),
  'fallback-marine-officer': combatPositions('601'),
  'fallback-marine-operator': combatPositions('602'),
  'fallback-rescue-float': combatPositions('213', '215', '701', '702', '703', '704', '705', '706'),
};

/** Exact source references read back from the sealed July-policy configuration.
 * This compatibility interpretation is returned only; it never alters saved
 * definitions, their hashes, or historical session snapshots. */
const july2026References: Readonly<
  Record<
    string,
    { sourceRef: string; prerequisite: Activation['prerequisite']; assignedOnly: boolean }
  >
> = {
  'fallback-captain5': {
    sourceRef: 'PDF p3 Procedure6b; Rules & Points!A3:C14; Points!BZ5:CE5',
    prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS',
    assignedOnly: true,
  },
  'fallback-designated-de': {
    sourceRef: 'PDF p7 Procedure12',
    prerequisite: 'ORDINARY_OPPORTUNITY_PATH_EXHAUSTED',
    assignedOnly: false,
  },
  'fallback-fire-investigator': {
    sourceRef: 'PDF p2 Procedure3e; Rules & Points!A176:C189',
    prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS',
    assignedOnly: true,
  },
  'fallback-main-airtech': {
    sourceRef: 'PDF p4 Procedure7(a), final minimum-qualified sentence',
    prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS',
    assignedOnly: false,
  },
  ...Object.fromEntries(
    ['deckhand', 'engineer', 'float', 'officer', 'operator'].map((role) => [
      `fallback-marine-${role}`,
      {
        sourceRef: 'PDF pp4-6 Procedure8; user clarification2026-09-19 minimum-qualified only',
        prerequisite: 'NO_QUALIFIED_VOLUNTEER_REMAINS' as const,
        assignedOnly: false,
      },
    ]),
  ),
  'fallback-rescue-float': {
    sourceRef: 'PDF p7 Procedure11b',
    prerequisite: 'ORDINARY_OPPORTUNITY_PATH_EXHAUSTED',
    assignedOnly: false,
  },
};

function sourceActivation(snapshot: Snapshot, fallback: Fallback): Activation | null {
  if (fallback.activation !== undefined) return fallback.activation;
  const reference = july2026References[fallback.id];
  const positionScope = july2026PositionScopes[fallback.id];
  const tier = fallback.tiers[0];
  if (
    snapshot.settings.v !== 3 ||
    snapshot.settings.livePolicy.policyRevision !== 'final2026-july-source-reconciliation' ||
    snapshot.annualPolicyEvidence?.executablePolicyRevision !==
      'final2026-july-source-reconciliation' ||
    snapshot.annualPolicyEvidence.ruleBookVersion !== snapshot.ruleBookVersion ||
    reference === undefined ||
    positionScope === undefined ||
    fallback.positionIds.length !== positionScope.length ||
    !positionScope.every((id) => fallback.positionIds.includes(id)) ||
    fallback.sourceDecisionId !== fallback.id ||
    fallback.sourceRef !== reference.sourceRef ||
    fallback.tiers.length !== 1 ||
    tier?.mode !== 'FORCED' ||
    tier.eligibility.kind !== 'MINIMUM_QUALIFIED' ||
    tier.currentlyAssignedOnly !== reference.assignedOnly ||
    tier.comparator.length !== 1 ||
    tier.comparator[0]?.key !== 'DEPARTMENT_SERVICE_BID_ORDINAL' ||
    tier.comparator[0].direction !== 'DESC' ||
    tier.historyPredicate !== undefined
  )
    return null;
  return { v: 1, prerequisite: reference.prerequisite, sourceRef: reference.sourceRef };
}

/** One deterministic timing authority shared by availability and canonical
 * command validation. Qualifications identify ordinary contenders; durable
 * target-stage outcomes establish exhaustion. Cursor/flags/contact alone do not. */
export function evaluateFallbackActivation(input: {
  snapshot: Snapshot;
  state: BidSessionState;
  fallback: Fallback;
  positionId: string;
  rule: PositionRule;
}) {
  const { snapshot, state, fallback, positionId, rule } = input;
  if (state.frozenAt !== null) return { ok: false as const, code: 'SESSION_FROZEN' };
  if (state.annual?.completion != null)
    return { ok: false as const, code: 'ANNUAL_COMPLETION_SEALED' };
  const activation = sourceActivation(snapshot, fallback);
  if (activation === null)
    return { ok: false as const, code: 'FALLBACK_TIMING_NEEDS_ADMIN_DECISION' };
  if (state.currentPhase !== 'position_bid' && state.currentPhase !== 'complete')
    return { ok: false as const, code: 'SESSION_NOT_ACTIVE' };
  if (state.live?.specialty != null)
    return { ok: false as const, code: 'SPECIALTY_ADJUDICATION_ACTIVE' };
  if (snapshot.settings.v !== 3)
    return { ok: false as const, code: 'FALLBACK_TIMING_NEEDS_ADMIN_DECISION' };
  const policy = snapshot.settings.livePolicy;
  const stages = policy.stages.filter((stage) => stage.opportunityPositionIds.includes(positionId));
  if (!stages.length) return { ok: false as const, code: 'FALLBACK_ORDINARY_SCOPE_UNAVAILABLE' };
  const awarded = new Set(Object.values(state.fills).map((fill) => fill.memberId));
  const blocked = new Set<number>();
  for (const stage of stages) {
    for (const memberId of stage.memberIds) {
      const member = snapshot.members.find((candidate) => candidate.memberId === memberId);
      if (member === undefined)
        return { ok: false as const, code: 'FALLBACK_ORDINARY_SCOPE_UNAVAILABLE' };
      if (
        member.pool === 'EXCLUDED' ||
        awarded.has(memberId) ||
        !evaluateEligibility(eligibilityMemberFromFrozen(member), rule).eligible
      )
        continue;
      if (
        state.annual?.unresolvedMemberIds.includes(memberId) ||
        state.annual?.returningMemberId === memberId ||
        state.annual?.returnedAtCurrentSequence.some((entry) => entry.memberId === memberId)
      ) {
        blocked.add(memberId);
        continue;
      }
      const entryIndex = state.bidOrder.findIndex(
        (entry) => entry.memberId === memberId && entry.stageId === stage.id,
      );
      const outcome = [...(state.live?.dispositions ?? [])]
        .reverse()
        .find((entry) => entry.memberId === memberId && entry.stageId === stage.id);
      const disposition = policy.dispositions.find(
        (candidate) => candidate.disposition === outcome?.disposition,
      );
      if (
        entryIndex < 0 ||
        entryIndex >= state.queueCursor ||
        outcome === undefined ||
        outcome.disposition === 'UNREACHABLE' ||
        disposition === undefined ||
        disposition.returns ||
        disposition.retainsLaterSelectionRights ||
        (outcome.disposition !== 'DECLINED' && !disposition.terminal)
      )
        blocked.add(memberId);
    }
  }
  if (blocked.size)
    return {
      ok: false as const,
      code: 'FALLBACK_ORDINARY_PATH_NOT_EXHAUSTED',
      blockingMemberIds: [...blocked],
    };
  return { ok: true as const, activation };
}

import { type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { eligibilityMemberFromFrozen } from './bid-policy.js';
import { sortWithFrozenOrdering } from './live-bid-policy.js';
import { decodePositionRule } from './position-rule.js';

/** Computes the active tier from frozen qualification/order facts and durable
 * responses. There is no operator-supplied exhaustion flag or candidate order. */
export function evaluateBidFallback(input: {
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>;
  state: BidSessionState;
  positionId: string;
}) {
  const { snapshot, state, positionId } = input;
  const policy =
    snapshot.settings.v === 3
      ? snapshot.settings.livePolicy.annualOperations?.fallbackPolicies?.find((p) =>
          p.positionIds.includes(positionId),
        )
      : undefined;
  if (!policy) return { ok: false as const, code: 'FALLBACK_POLICY_MISSING' };
  if (state.fills[positionId]) return { ok: false as const, code: 'POSITION_FILLED' };
  const raw = snapshot.ruleBookMaterial.rules.find((rule) => rule.positionId === positionId);
  const decoded = raw ? decodePositionRule(raw) : null;
  if (!decoded?.ok) return { ok: false as const, code: 'FALLBACK_RULE_MISSING' };
  const awarded = new Set(Object.values(state.fills).map((fill) => fill.memberId));
  const available = snapshot.members.filter(
    (member) => member.pool !== 'EXCLUDED' && !awarded.has(member.memberId),
  );
  const exhausted: { tierId: string; eligibleMemberIds: number[]; reason: string }[] = [];
  for (const tier of policy.tiers) {
    const requirements =
      tier.eligibility.kind === 'EXPLICIT_REQUIREMENTS' ? tier.eligibility.requirements : null;
    const rule: PositionRule = requirements
      ? {
          ...decoded.rule,
          requiredCriteria: {
            rank: requirements.ranks ?? decoded.rule.requiredCriteria.rank,
            credentials: requirements.credentials,
            custom: requirements.custom,
            ...(requirements.anyOfCredentials === undefined
              ? {}
              : { anyOfCredentials: requirements.anyOfCredentials }),
            ...(requirements.service === undefined ? {} : { service: requirements.service }),
            ...(requirements.postAward === undefined ? {} : { postAward: requirements.postAward }),
          },
        }
      : decoded.rule;
    if (
      tier.currentlyAssignedOnly &&
      available.some((member) => member.currentBidPositionIds === undefined)
    )
      return { ok: false as const, code: 'FALLBACK_CURRENT_ASSIGNMENT_EVIDENCE_MISSING' };
    const qualified = available.filter(
      (member) =>
        (tier.mode !== 'FORCED' || member.termParticipation === undefined) &&
        (!tier.currentlyAssignedOnly ||
          member.currentBidPositionIds?.some((id) => policy.positionIds.includes(id))) &&
        evaluateEligibility(eligibilityMemberFromFrozen(member), rule).eligible,
    );
    if (
      tier.historyPredicate &&
      qualified.some(
        (member) =>
          member.bidTourEvidence?.completedDaysTour === undefined ||
          member.bidTourEvidence.completedDaysTour === null,
      )
    )
      return { ok: false as const, code: 'FALLBACK_DAYS_TOUR_HISTORY_REQUIRED' };
    const eligible = tier.historyPredicate
      ? qualified.filter((member) => member.bidTourEvidence?.completedDaysTour === false)
      : qualified;
    const ordered = sortWithFrozenOrdering(eligible, tier.comparator);
    if (!ordered.ok) return { ok: false as const, code: ordered.code.toUpperCase() };
    const responses = state.live?.fallbackResponses ?? [];
    const candidates = ordered.members.filter(
      (member) =>
        !responses.some(
          (response) =>
            response.policyId === policy.id &&
            response.positionId === positionId &&
            response.tierId === tier.id &&
            response.memberId === member.memberId,
        ),
    );
    if (candidates.length)
      return {
        ok: true as const,
        policyId: policy.id,
        label: policy.label,
        sourceRef: policy.sourceRef,
        sourceDecisionId: policy.sourceDecisionId,
        tierId: tier.id,
        tierLabel: tier.label,
        mode: tier.mode,
        comparator: tier.comparator,
        eligibleMemberIds: ordered.members.map((m) => m.memberId),
        candidateMemberIds: candidates.map((m) => m.memberId),
        exhausted,
        rule,
      };
    exhausted.push({
      tierId: tier.id,
      eligibleMemberIds: ordered.members.map((m) => m.memberId),
      reason: eligible.length
        ? 'ALL_ELIGIBLE_CANDIDATES_RESPONDED'
        : 'NO_ELIGIBLE_AVAILABLE_CANDIDATES',
    });
  }
  return { ok: false as const, code: 'FALLBACK_TIERS_EXHAUSTED', exhausted };
}

import { type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot, FrozenLiveBidPolicy } from '@mbfd/shared';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { rankFrozenSpecialtyCandidates } from './annual-specialty-policy.js';
import { eligibilityMemberFromFrozen, frozenEligibilityMemberForSession } from './bid-policy.js';

/** A specialty's pool contains only members eligible for one of its captured
 * seats. Rank-specific ordinal requirements never apply to unrelated or
 * excluded people merely because the specialty has no credential minimum. */
export function eligibleFrozenSpecialtyMembers(input: {
  snapshot: Pick<Extract<BidSessionPolicySnapshot, { v: 3 }>, 'members'>;
  rules: readonly PositionRule[];
  policy: { opportunityPositionIds: readonly string[] };
}) {
  const relatedRules = input.rules.filter((rule) =>
    input.policy.opportunityPositionIds.includes(rule.positionId),
  );
  return input.snapshot.members.filter(
    (member) =>
      member.pool !== 'EXCLUDED' &&
      relatedRules.some(
        (rule) => evaluateEligibility(eligibilityMemberFromFrozen(member), rule).eligible,
      ),
  );
}

/** Latest canonical dispositions determine whether a member is still available
 * for a seat. Retained deferrals and skips keep their rights; an explicit
 * return at the active sequence restores a member whose prior rights ended. */
export function endedLiveSelectionRights(
  state: BidSessionState,
  policy: FrozenLiveBidPolicy,
): ReadonlySet<number> {
  const latest = new Map(
    (state.live?.dispositions ?? []).map((entry) => [entry.memberId, entry.disposition]),
  );
  const rules = new Map<string, FrozenLiveBidPolicy['dispositions'][number]>(
    policy.dispositions.map((rule) => [rule.disposition, rule]),
  );
  return new Set(
    [...latest].flatMap(([memberId, disposition]) => {
      if (state.annual?.returningMemberId === memberId) return [];
      const rule = rules.get(disposition);
      return rule && (rule.terminal || !rule.retainsLaterSelectionRights) ? [memberId] : [];
    }),
  );
}

/** Uses only the exact session's captured evidence and canonical progress.
 * A declined opportunity is scoped to this requester and seat, not a blanket
 * waiver of another member's specialty rights. */
export function unresolvedSpecialtyPriority(input: {
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>;
  state: BidSessionState;
  memberId: number;
  positionId: string;
  rule: PositionRule;
  requestContext?: { specialtyId: string; positionId: string; requesterMemberId: number };
}): { specialtyId: string; candidateMemberIds: number[] }[] {
  if (input.snapshot.settings.v !== 3) throw new Error('LIVE_POLICY_MISMATCH');
  const policies = (input.snapshot.settings.livePolicy.annualOperations?.specialties ?? []).filter(
    (policy) =>
      policy.mode === 'INTERRUPTING' && policy.opportunityPositionIds.includes(input.positionId),
  );
  if (!policies.length) return [];
  if (input.snapshot.credentialEvaluationOn === undefined)
    throw new Error('LIVE_SPECIALTY_EVIDENCE_DATE_MISSING');
  const unavailable = new Set(
    Object.entries(input.state.fills)
      .filter(([position]) => position !== input.positionId)
      .map(([, fill]) => fill.memberId),
  );
  for (const assignment of input.state.live?.exceptionalAssignments ?? [])
    if (assignment.releasedAtMs === null) unavailable.add(assignment.memberId);
  for (const memberId of endedLiveSelectionRights(input.state, input.snapshot.settings.livePolicy))
    unavailable.add(memberId);
  const members = input.snapshot.members
    .filter((member) => {
      if (
        member.pool === 'EXCLUDED' ||
        (member.memberId !== input.memberId && unavailable.has(member.memberId))
      )
        return false;
      const evidence = frozenEligibilityMemberForSession(input.snapshot, member.memberId);
      return (
        evidence !== null &&
        evaluateEligibility(eligibilityMemberFromFrozen(evidence), input.rule).eligible
      );
    })
    .map((member) => ({ ...member, specialtyQualifications: member.specialtyQualifications }));
  return policies.map((policy) => {
    const active = input.state.live?.specialty;
    const requesterMemberId =
      input.requestContext?.specialtyId === policy.id &&
      input.requestContext.positionId === input.positionId
        ? input.requestContext.requesterMemberId
        : active?.specialtyId === policy.id && active.positionId === input.positionId
          ? active.suspendedBidderId
          : input.memberId;
    const ranked = rankFrozenSpecialtyCandidates({
      policy,
      evaluationOn: input.snapshot.credentialEvaluationOn as string,
      members,
    });
    const requester = ranked.findIndex((member) => member.memberId === input.memberId);
    if (requester < 0) throw new Error('SPECIALTY_REQUESTER_NOT_QUALIFIED');
    return {
      specialtyId: policy.id,
      candidateMemberIds: ranked
        .slice(0, requester)
        .map((member) => member.memberId)
        .filter(
          (memberId) =>
            !input.state.live?.specialtyResponses?.some(
              (response) =>
                response.specialtyId === policy.id &&
                response.positionId === input.positionId &&
                response.requesterMemberId === requesterMemberId &&
                response.memberId === memberId,
            ),
        ),
    };
  });
}

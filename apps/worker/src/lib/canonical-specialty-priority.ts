import { type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { rankFrozenSpecialtyCandidates } from './annual-specialty-policy.js';
import { eligibilityMemberFromFrozen, frozenEligibilityMemberForSession } from './bid-policy.js';

/** Uses only the exact session's captured evidence and canonical progress.
 * A declined opportunity is scoped to this requester and seat, not a blanket
 * waiver of another member's specialty rights. */
export function unresolvedSpecialtyPriority(input: {
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>;
  state: BidSessionState;
  memberId: number;
  positionId: string;
  rule: PositionRule;
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
      active?.specialtyId === policy.id && active.positionId === input.positionId
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

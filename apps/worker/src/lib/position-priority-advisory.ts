import { type PositionRule, evaluateEligibilityCohort } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { eligibilityMemberFromFrozen } from './bid-policy.js';
import { endedLiveSelectionRights } from './canonical-specialty-priority.js';

export function hasFrozenPriorityPreference(rule: PositionRule): boolean {
  const scoring = rule.pointsPreference.scoring;
  return (
    rule.pointsPreference.items.length > 0 ||
    !!(
      scoring &&
      (scoring.total.length > 0 ||
        scoring.so.length > 0 ||
        scoring.mo.length > 0 ||
        scoring.orderedPreference)
    )
  );
}

/** Guide any scored source profile without inventing an interrupting policy.
 * The administrator can award a candidate through the existing reviewed action. */
export function frozenPositionPriorityAdvisory(input: {
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>;
  state: BidSessionState;
  memberId: number;
  rule: PositionRule;
  rules: readonly PositionRule[];
}) {
  if (input.snapshot.settings.v !== 3) throw new Error('LIVE_POLICY_MISMATCH');
  const { rule } = input;
  if (!hasFrozenPriorityPreference(rule)) return null;
  const asOf = input.snapshot.credentialEvaluationOn;
  if (!asOf) throw new Error('LIVE_SPECIALTY_EVIDENCE_DATE_MISSING');
  const unavailable = new Set(Object.values(input.state.fills).map((fill) => fill.memberId));
  for (const assignment of input.state.live?.exceptionalAssignments ?? [])
    if (assignment.releasedAtMs === null) unavailable.add(assignment.memberId);
  for (const id of endedLiveSelectionRights(input.state, input.snapshot.settings.livePolicy))
    unavailable.add(id);
  const cohort = evaluateEligibilityCohort({
    asOf,
    rule,
    members: input.snapshot.members
      .filter(
        (member) =>
          member.pool !== 'EXCLUDED' &&
          (member.memberId === input.memberId || !unavailable.has(member.memberId)),
      )
      .map((member) => ({
        ...eligibilityMemberFromFrozen(member),
        employeeId: String(member.memberId),
        memberId: member.memberId,
      })),
  });
  const requester = cohort.eligible.findIndex(
    (decision) => decision.member.memberId === input.memberId,
  );
  if (requester < 0) {
    if (cohort.dataBlocked.some((decision) => decision.member.memberId === input.memberId))
      throw new Error('BID_ORDINAL_EVIDENCE_MISSING');
    return null;
  }
  const higher = cohort.eligible.slice(0, requester);
  if (!higher.length) return null;
  const identities = new Map(
    (input.snapshot.operatorIdentityProjection ?? []).map((identity) => [
      identity.memberId,
      identity,
    ]),
  );
  const pointChannel = rule.tieBreakChain.find((key) =>
    ['points', 'so_points', 'mo_points'].includes(key),
  );
  const family = (candidate: PositionRule) =>
    canonicalize(
      JSON.parse(
        JSON.stringify({
          requiredCriteria: candidate.requiredCriteria,
          pointsPreference: candidate.pointsPreference,
          tieBreakChain: candidate.tieBreakChain,
        }),
      ) as JsonValue,
    );
  const signature = family(rule);
  const position = input.snapshot.ruleBookMaterial.positions.find(
    (entry) => entry.id === rule.positionId,
  );
  return {
    member_id: input.memberId,
    position_id: rule.positionId,
    mode: 'ADVISORY' as const,
    specialty_id: null,
    specialty_label: position?.positionName ?? rule.positionId,
    higher_priority_candidates: higher.map((decision) => {
      const id = decision.member.memberId as number;
      const identity = identities.get(id);
      return {
        member_id: id,
        first_name: identity?.firstName ?? '',
        last_name: identity?.lastName ?? '',
        rank: identity?.rank ?? null,
        points:
          pointChannel === 'so_points'
            ? decision.result.soPoints
            : pointChannel === 'mo_points'
              ? decision.result.moPoints
              : decision.result.points,
        policy_rank: decision.priority,
      };
    }),
    eligible_related_position_ids: input.rules
      .filter(
        (candidate) => !input.state.fills[candidate.positionId] && family(candidate) === signature,
      )
      .map((candidate) => candidate.positionId),
    a_day_timing: 'ADMIN_REVIEW' as const,
  };
}

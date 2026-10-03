import { type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { rankFrozenSpecialtyCandidates } from './annual-specialty-policy.js';
import { eligibilityMemberFromFrozen } from './bid-policy.js';
import {
  eligibleFrozenSpecialtyMembers,
  endedLiveSelectionRights,
} from './canonical-specialty-priority.js';
import { adviseFrozenSpecialtyCoverage } from './specialty-coverage-advisory.js';

/** Counts actual frozen eligibility for open credential-dependent seats, including
 * DE and Air Tech. No mutable credential, rank, source or staffing inference. */
function calculateFrozenCredentialCoverage(input: {
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>;
  rules: readonly PositionRule[];
  state: BidSessionState;
}) {
  const annual =
    input.snapshot.settings.v === 3
      ? input.snapshot.settings.livePolicy.annualOperations
      : undefined;
  const specialties = annual?.specialties ?? [];
  const groups = new Map<string, { label: string; positionIds: string[] }>();
  for (const rule of input.rules) {
    const specialty = specialties.find((entry) =>
      entry.opportunityPositionIds.includes(rule.positionId),
    );
    const criteria = rule.requiredCriteria;
    const required = [
      ...criteria.credentials,
      ...criteria.custom.filter((name) => name === 'driver_engineer' || name === 'paramedic'),
    ];
    if (!specialty && !required.length && !criteria.anyOfCredentials?.length) continue;
    const id = specialty
      ? `specialty:${specialty.id}`
      : `credentials:${JSON.stringify({ rank: [...criteria.rank].sort(), required: [...required].sort(), anyOf: criteria.anyOfCredentials ?? [] })}`;
    const label =
      specialty?.label ??
      [
        ...criteria.credentials,
        ...criteria.custom
          .filter((name) => name === 'driver_engineer' || name === 'paramedic')
          .map((name) => (name === 'driver_engineer' ? 'Driver Engineer' : 'Paramedic')),
        ...(criteria.anyOfCredentials ?? []).map((names) => names.join(' or ')),
      ].join(' + ');
    const group = groups.get(id) ?? { label, positionIds: [] };
    group.positionIds.push(rule.positionId);
    groups.set(id, group);
  }
  const rulesById = new Map(input.rules.map((rule) => [rule.positionId, rule]));
  const specialtyCandidates = new Map(
    specialties.map((specialty) => [
      specialty.id,
      new Set(
        rankFrozenSpecialtyCandidates({
          policy: specialty,
          evaluationOn: input.snapshot.credentialEvaluationOn ?? '',
          members: eligibleFrozenSpecialtyMembers({
            snapshot: input.snapshot,
            rules: input.rules,
            policy: specialty,
          }).map((member) => ({
            ...member,
            specialtyQualifications: member.specialtyQualifications,
          })),
        }).map((member) => member.memberId),
      ),
    ]),
  );
  const positions = [...groups].flatMap(([id, group]) =>
    group.positionIds.map((positionId) => ({
      seatId: positionId,
      positionId,
      ruleGroupId: id,
      filled: input.state.fills[positionId] !== undefined,
    })),
  );
  const members = input.snapshot.members.filter((member) => member.pool !== 'EXCLUDED');
  const assigned = [
    ...new Set([
      ...Object.values(input.state.fills).map((fill) => fill.memberId),
      ...(input.state.live?.exceptionalAssignments ?? [])
        .filter((entry) => entry.releasedAtMs === null)
        .map((entry) => entry.memberId),
      ...(input.snapshot.settings.v === 3
        ? endedLiveSelectionRights(input.state, input.snapshot.settings.livePolicy)
        : []),
    ]),
  ];
  const advisory = adviseFrozenSpecialtyCoverage({
    mode: 'live',
    frozenMembers: input.snapshot.members,
    specialtySeats: positions,
    assignedMemberIds: assigned,
    frozenEligibilityEdges: positions.flatMap((seat) => {
      const rule = rulesById.get(seat.positionId);
      const specialty = specialties.find((entry) =>
        entry.opportunityPositionIds.includes(seat.positionId),
      );
      return rule
        ? members
            .filter(
              (member) =>
                (!specialty || specialtyCandidates.get(specialty.id)?.has(member.memberId)) &&
                evaluateEligibility(eligibilityMemberFromFrozen(member), rule).eligible,
            )
            .map((member) => ({ seatId: seat.seatId, memberId: member.memberId }))
        : [];
    }),
  });
  return {
    availability: 'AVAILABLE' as const,
    source: 'FROZEN_SESSION_SNAPSHOT' as const,
    status: advisory.status,
    guaranteed_uncovered_seat_count: advisory.guaranteedUncoveredSeatCount,
    critical_member_ids: advisory.criticalMemberIds,
    groups: advisory.ruleGroups.map((group) => {
      const remaining = group.remainingSeatCount;
      const eligible = group.simpleEligibleMemberIds.length;
      return {
        id: group.ruleGroupId,
        label: groups.get(group.ruleGroupId)?.label ?? group.ruleGroupId,
        remaining_seat_count: remaining,
        eligible_member_ids: group.simpleEligibleMemberIds,
        eligible_member_count: eligible,
        buffer: eligible - remaining,
        status:
          eligible < remaining
            ? ('SHORTAGE' as const)
            : remaining > 0 && eligible <= remaining * 2
              ? ('LOW_BUFFER' as const)
              : ('FEASIBLE' as const),
        critical_member_ids: advisory.criticalMemberIds.filter((id) =>
          group.simpleEligibleMemberIds.includes(id),
        ),
      };
    }),
  };
}

/** An advisory cannot prevent the operator from reading canonical controls. */
export function projectFrozenCredentialCoverage(
  input: Parameters<typeof calculateFrozenCredentialCoverage>[0],
) {
  const unavailable = (code: string) => ({
    availability: 'UNAVAILABLE' as const,
    source: 'FROZEN_SESSION_SNAPSHOT' as const,
    code,
  });
  if (input.snapshot.settings.v !== 3) return unavailable('CREDENTIAL_COVERAGE_POLICY_MISSING');
  if (!input.snapshot.credentialEvaluationOn)
    return unavailable('CREDENTIAL_COVERAGE_EVIDENCE_DATE_MISSING');
  try {
    return calculateFrozenCredentialCoverage(input);
  } catch {
    return unavailable('CREDENTIAL_COVERAGE_EVALUATION_UNAVAILABLE');
  }
}

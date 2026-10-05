import {
  type PositionRule,
  evaluateEligibility,
  evaluateEligibilityCohort,
  scoreReferenceForPositions,
} from '@mbfd/eligibility';
import type {
  BidSessionPolicySnapshot,
  FrozenAnnualSpecialtyPolicy,
  FrozenBidEligibilityMember,
} from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { rankFrozenSpecialtyCandidates } from './annual-specialty-policy.js';
import { eligibilityMemberFromFrozen } from './bid-policy.js';
import {
  eligibleFrozenSpecialtyMembers,
  endedLiveSelectionRights,
} from './canonical-specialty-priority.js';
import type { projectFrozenCredentialCoverage } from './credential-coverage-advisory.js';
import { hasFrozenPriorityPreference } from './position-priority-advisory.js';

type Candidate = {
  memberId: number;
  priority: number | null;
  points: number | null;
  eligiblePositionIds: string[];
  available: boolean;
};
type Group = {
  id: string;
  label: string;
  positionIds: string[];
  candidates: Candidate[];
  remainingSeatCount: number | null;
  eligibleMemberCount: number;
  status: 'FEASIBLE' | 'LOW_BUFFER' | 'SHORTAGE' | null;
  criticalMemberIds: number[];
  rankingAvailable: boolean;
  dataBlockedMemberIds: number[];
  rankingCode?: string;
};
type Input = {
  sessionId: string;
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>;
  rules: readonly PositionRule[];
  state: BidSessionState;
  credentialCoverage: ReturnType<typeof projectFrozenCredentialCoverage>;
};

function profileSignature(rule: PositionRule, members: readonly FrozenBidEligibilityMember[]) {
  return canonicalize(
    JSON.parse(
      JSON.stringify({
        requiredCriteria: rule.requiredCriteria,
        pointsPreference: rule.pointsPreference,
        tieBreakChain: rule.tieBreakChain,
        // Identical authored rules are insufficient: exact-position reviewed
        // score evidence can change both points and published priority. Omit
        // documentary fields and positionIds so equivalent cross-shift scopes
        // still share one roster.
        effectiveScoreReferences: members.map((member) => {
          const reference = scoreReferenceForPositions(member.scoreReferenceEvidence, [
            rule.positionId,
          ]);
          return [
            member.memberId,
            reference
              ? {
                  listId: reference.listId,
                  sourceSha256: reference.sourceSha256,
                  sourcePriority: reference.sourcePriority,
                  points: reference.points,
                  soPoints: reference.soPoints,
                  moPoints: reference.moPoints,
                }
              : null,
          ];
        }),
      }),
    ) as JsonValue,
  );
}

/** Uses the exact canonical evaluators and current progress. No new qualification,
 * priority, interruption, seat reservation or bid mutation is introduced. */
export function projectOperatorSpecialtyRoster(input: Input) {
  const unavailable = (code: string) => ({
    sessionId: input.sessionId,
    sequence: input.state.lastSeq,
    availability: 'UNAVAILABLE' as const,
    groups: [] as Group[],
    combinedShortage: null,
    code,
  });
  if (input.snapshot.settings.v !== 3) return unavailable('SPECIALTY_ROSTER_POLICY_MISSING');
  const asOf = input.snapshot.credentialEvaluationOn;
  if (!asOf) return unavailable('SPECIALTY_ROSTER_EVIDENCE_DATE_MISSING');
  try {
    const policy = input.snapshot.settings.livePolicy;
    const positions = new Map(
      input.snapshot.ruleBookMaterial.positions.map((position) => [position.id, position]),
    );
    const members = input.snapshot.members.filter((member) => member.pool !== 'EXCLUDED');
    const byMember = new Map(members.map((member) => [member.memberId, member]));
    const unavailableIds = new Set(Object.values(input.state.fills).map((fill) => fill.memberId));
    for (const assignment of input.state.live?.exceptionalAssignments ?? [])
      if (assignment.releasedAtMs === null) unavailableIds.add(assignment.memberId);
    for (const memberId of endedLiveSelectionRights(input.state, policy))
      unavailableIds.add(memberId);
    const rules = input.rules.filter(
      (rule) => positions.get(rule.positionId)?.bidParticipation === 'BIDDABLE',
    );
    const families = new Map<
      string,
      { label: string; rules: PositionRule[]; specialty?: FrozenAnnualSpecialtyPolicy }
    >();
    const annualSpecialties = policy.annualOperations?.specialties ?? [];
    for (const specialty of annualSpecialties) {
      const related = rules.filter((rule) =>
        specialty.opportunityPositionIds.includes(rule.positionId),
      );
      if (related.length)
        families.set(`specialty:${specialty.id}`, {
          label: specialty.label,
          rules: related,
          specialty,
        });
    }
    const profiles = new Map<string, PositionRule[]>();
    for (const rule of rules) {
      if (
        annualSpecialties.some((specialty) =>
          specialty.opportunityPositionIds.includes(rule.positionId),
        )
      )
        continue;
      const criteria = rule.requiredCriteria;
      if (
        !criteria.credentials.length &&
        !criteria.anyOfCredentials?.length &&
        !criteria.custom.some((key) => key === 'driver_engineer' || key === 'paramedic') &&
        !hasFrozenPriorityPreference(rule)
      )
        continue;
      const signature = profileSignature(rule, members);
      profiles.set(signature, [...(profiles.get(signature) ?? []), rule]);
    }
    for (const related of profiles.values()) {
      const first = related[0];
      if (!first) continue;
      const position = positions.get(first.positionId);
      const criteria = first.requiredCriteria;
      const names = [
        ...new Set(
          related.map((rule) => positions.get(rule.positionId)?.positionName).filter(Boolean),
        ),
      ];
      const label =
        criteria.credentials.length === 1 && criteria.credentials[0] === 'Driver Engineer Qualified'
          ? 'Driver Engineer'
          : position?.unit === 'Fire Boat 6'
            ? `Marine · ${position.positionName}`
            : position?.positionName.endsWith(' AT')
              ? 'Air Tech 810'
              : names.length === 1
                ? (names[0] ?? first.positionId)
                : [
                    ...criteria.credentials,
                    ...criteria.custom.map((key) => (key === 'paramedic' ? 'Paramedic' : key)),
                  ].join(' + ');
      families.set(`profile:${first.positionId}`, { label, rules: related });
    }
    const coverage = input.credentialCoverage;
    const criticalIds = coverage.availability === 'AVAILABLE' ? coverage.critical_member_ids : [];
    const groups: Group[] = [];
    for (const [id, family] of families) {
      const first = family.rules[0];
      if (!first) continue;
      const positionIds = family.rules.map((rule) => rule.positionId);
      const remainingSeatCount = positionIds.filter(
        (positionId) => !input.state.fills[positionId],
      ).length;
      const eligiblePositions = (memberId: number) => {
        // Generic families have identical qualification profiles. The cohort
        // already evaluated qualification once; only annual policies need the
        // per-position edge checks across their possibly different rules.
        if (!family.specialty) return positionIds;
        const member = byMember.get(memberId);
        return member
          ? family.rules
              .filter(
                (rule) => evaluateEligibility(eligibilityMemberFromFrozen(member), rule).eligible,
              )
              .map((rule) => rule.positionId)
          : [];
      };
      let candidates: Candidate[] = [];
      let dataBlockedMemberIds: number[] = [];
      let rankingCode: string | undefined;
      try {
        if (family.specialty) {
          const ranked = rankFrozenSpecialtyCandidates({
            policy: family.specialty,
            evaluationOn: asOf,
            members: eligibleFrozenSpecialtyMembers({
              snapshot: input.snapshot,
              rules: family.rules,
              policy: family.specialty,
            }).map((member) => ({
              ...member,
              specialtyQualifications: member.specialtyQualifications,
            })),
          });
          candidates = ranked.map((candidate, index) => ({
            memberId: candidate.memberId,
            priority: index + 1,
            points: candidate.points,
            eligiblePositionIds: eligiblePositions(candidate.memberId),
            available: !unavailableIds.has(candidate.memberId),
          }));
        } else {
          const cohort = evaluateEligibilityCohort({
            asOf,
            rule: first,
            members: members.map(eligibilityMemberFromFrozen),
          });
          const channel = first.tieBreakChain.find((key) =>
            ['points', 'so_points', 'mo_points'].includes(key),
          );
          const projected = (decision: (typeof cohort.eligible)[number]): Candidate => ({
            memberId: decision.member.memberId as number,
            priority: decision.priority,
            points:
              channel === 'so_points'
                ? decision.result.soPoints
                : channel === 'mo_points'
                  ? decision.result.moPoints
                  : decision.result.points,
            eligiblePositionIds: eligiblePositions(decision.member.memberId as number),
            available: !unavailableIds.has(decision.member.memberId as number),
          });
          candidates = [...cohort.eligible.map(projected), ...cohort.dataBlocked.map(projected)];
          dataBlockedMemberIds = cohort.dataBlocked.map(
            (decision) => decision.member.memberId as number,
          );
          if (dataBlockedMemberIds.length)
            rankingCode = 'SPECIALTY_ROSTER_ORDER_EVIDENCE_INCOMPLETE';
        }
      } catch {
        rankingCode = 'SPECIALTY_ROSTER_ORDER_UNAVAILABLE';
        // Failure of ranking never manufactures priority or skips qualification.
        candidates = [];
      }
      const remaining = candidates.filter(
        (candidate) =>
          candidate.available &&
          candidate.eligiblePositionIds.some((positionId) => !input.state.fills[positionId]),
      );
      groups.push({
        id,
        label: family.label,
        positionIds,
        candidates,
        remainingSeatCount,
        eligibleMemberCount: remaining.length,
        status: rankingCode
          ? null
          : remaining.length < remainingSeatCount
            ? 'SHORTAGE'
            : remainingSeatCount > 0 && remaining.length <= remainingSeatCount * 2
              ? 'LOW_BUFFER'
              : 'FEASIBLE',
        criticalMemberIds: criticalIds.filter((memberId) =>
          remaining.some((candidate) => candidate.memberId === memberId),
        ),
        rankingAvailable: rankingCode === undefined,
        dataBlockedMemberIds,
        ...(rankingCode ? { rankingCode } : {}),
      });
    }
    // Split source scopes need distinguishable choices in the compact selector.
    const labelCounts = new Map<string, number>();
    for (const group of groups)
      labelCounts.set(group.label, (labelCounts.get(group.label) ?? 0) + 1);
    for (const group of groups)
      if ((labelCounts.get(group.label) ?? 0) > 1)
        group.label = `${group.label} · ${group.positionIds[0]}`;
    for (const distribution of policy.annualOperations?.membershipDistributions ?? []) {
      if (distribution.membershipSource !== 'REVIEWED_QUALIFIED_POOL') continue;
      const candidates = distribution.memberIds
        .filter((memberId) => byMember.has(memberId))
        .map((memberId) => ({
          memberId,
          priority: null,
          points: null,
          eligiblePositionIds: [],
          available: !unavailableIds.has(memberId),
        }));
      groups.push({
        id: `membership:${distribution.id}`,
        label: `${distribution.label} membership`,
        positionIds: [],
        candidates,
        remainingSeatCount: null,
        eligibleMemberCount: candidates.filter((candidate) => candidate.available).length,
        status: null,
        criticalMemberIds: [],
        rankingAvailable: false,
        dataBlockedMemberIds: [],
      });
    }
    return {
      sessionId: input.sessionId,
      sequence: input.state.lastSeq,
      availability: 'AVAILABLE' as const,
      groups,
      combinedShortage:
        coverage.availability === 'AVAILABLE' ? coverage.guaranteed_uncovered_seat_count : null,
    };
  } catch {
    return unavailable('SPECIALTY_ROSTER_EVALUATION_UNAVAILABLE');
  }
}

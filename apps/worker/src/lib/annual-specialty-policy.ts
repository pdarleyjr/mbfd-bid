import { configuredChannel } from '@mbfd/eligibility';
import type { FrozenAnnualSpecialtyPolicy } from '@mbfd/shared';

export interface FrozenSpecialtyCandidateFact {
  readonly memberId: number;
  readonly rscSeniority: number;
  readonly rankSeniority: number | null;
  readonly credentialNames: readonly string[];
  readonly specialtyQualifications:
    | readonly {
        readonly specialtyCode: string;
        readonly status: 'active' | 'expired' | 'revoked' | 'removed';
        readonly effectiveOn: string;
        readonly expiresOn: string | null;
      }[]
    | undefined;
}

export interface RankedFrozenSpecialtyCandidate {
  readonly memberId: number;
  readonly points: number;
}

function qualificationIsActiveOn(
  qualification: NonNullable<FrozenSpecialtyCandidateFact['specialtyQualifications']>[number],
  evaluationOn: string,
): boolean {
  return (
    qualification.status === 'active' &&
    qualification.effectiveOn <= evaluationOn &&
    (qualification.expiresOn === null || qualification.expiresOn >= evaluationOn)
  );
}

/**
 * Replays the policy's specialty eligibility and ranking solely from frozen
 * session facts. It accepts no browser ordering, live credential lookup, or
 * staff roster fallback.
 */
export function rankFrozenSpecialtyCandidates(input: {
  readonly policy: FrozenAnnualSpecialtyPolicy;
  readonly evaluationOn: string;
  readonly members: readonly FrozenSpecialtyCandidateFact[];
}): readonly RankedFrozenSpecialtyCandidate[] {
  if (
    (input.policy.scoring === undefined) !== (input.policy.rankingChannel === undefined) ||
    (input.policy.scoring && input.policy.points.length)
  )
    throw new Error('SPECIALTY_SCORING_CONFIGURATION_INVALID');
  if (
    input.policy.tieBreakChain.some(
      (entry) => !['POINTS', 'RSC_SENIORITY', 'RANK_SENIORITY'].includes(entry),
    )
  )
    throw new Error('SPECIALTY_TIEBREAK_UNCONFIGURED');
  const pointsByCredential = new Map(
    input.policy.points.map((entry) => [entry.credentialName, entry.value]),
  );
  const candidates = input.members.flatMap((member) => {
    const credentials = new Set(member.credentialNames);
    if (input.policy.requiredCredentialNames.some((name) => !credentials.has(name))) return [];
    const qualifications = member.specialtyQualifications;
    if (
      qualifications === undefined ||
      input.policy.requiredSpecialtyCodes.some(
        (code) =>
          !qualifications.some(
            (qualification) =>
              qualification.specialtyCode === code &&
              qualificationIsActiveOn(qualification, input.evaluationOn),
          ),
      )
    )
      return [];
    const points =
      input.policy.scoring && input.policy.rankingChannel
        ? configuredChannel(
            { credentials: [...credentials].map((name) => ({ name })) },
            input.policy.scoring[input.policy.rankingChannel],
          ).total
        : [...credentials].reduce(
            (total, credential) => total + (pointsByCredential.get(credential) ?? 0),
            0,
          );
    return [{ member, points }];
  });
  return candidates
    .sort((left, right) => {
      for (const rule of input.policy.tieBreakChain) {
        const difference =
          rule === 'POINTS'
            ? right.points - left.points
            : rule === 'RSC_SENIORITY'
              ? left.member.rscSeniority - right.member.rscSeniority
              : (left.member.rankSeniority ?? Number.MAX_SAFE_INTEGER) -
                (right.member.rankSeniority ?? Number.MAX_SAFE_INTEGER);
        if (difference !== 0) return difference;
      }
      // An exact policy-chain tie is a policy failure, not an implicit member-id tiebreak.
      throw new Error('SPECIALTY_TIE_UNRESOLVED');
    })
    .map(({ member, points }) => ({ memberId: member.memberId, points }));
}

/**
 * Limits an interruption to candidates who are both ahead of the frozen
 * requester in the specialty ordering and eligible for the exact frozen
 * position. The caller supplies only eligibility outcomes derived from the
 * same session snapshot; this function never reads a live roster or accepts a
 * browser-provided rank/order.
 */
export function higherPriorityFrozenSpecialtyCandidates(input: {
  readonly policy: FrozenAnnualSpecialtyPolicy;
  readonly evaluationOn: string;
  readonly members: readonly FrozenSpecialtyCandidateFact[];
  readonly requesterMemberId: number;
  readonly positionEligibleMemberIds: ReadonlySet<number>;
}): readonly RankedFrozenSpecialtyCandidate[] {
  if (!input.positionEligibleMemberIds.has(input.requesterMemberId))
    throw new Error('SPECIALTY_REQUESTER_POSITION_INELIGIBLE');
  const ranked = rankFrozenSpecialtyCandidates(input);
  const requesterIndex = ranked.findIndex(
    (candidate) => candidate.memberId === input.requesterMemberId,
  );
  if (requesterIndex < 0) throw new Error('SPECIALTY_REQUESTER_NOT_QUALIFIED');
  return ranked
    .slice(0, requesterIndex)
    .filter((candidate) => input.positionEligibleMemberIds.has(candidate.memberId));
}

import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  FINAL_2026_BLOOMFIELD,
  FINAL_2026_NON_BIDDER_EMPLOYEE_IDS,
  FINAL_2026_SWAT_EMPLOYEE_IDS,
  FrozenLiveBidPolicySchema,
} from '@mbfd/shared';

export const REQUIRED_2026_ADMIN_EMPLOYEE_IDS = ['20731', '19545', '20732', '18156'] as const;

export type BidMemberOption = {
  value: string;
  label: string;
  employeeId: string;
  rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
  bidCategory: 'OFC' | 'FF' | 'EXCLUDED';
  employmentStatus: 'unknown' | 'active' | 'inactive' | 'retired' | 'separated';
  priorPositionId: string | null;
};

type Result = { ok: true; content: BidDefinitionContent } | { ok: false; message: string };

function stageMembers(
  stage: NonNullable<BidDefinitionContent['pendingPolicy']>['executionPolicy']['stages'][number],
  sources: NonNullable<
    NonNullable<BidDefinitionContent['pendingPolicy']>['stageParticipantSources']
  >,
  members: readonly BidMemberOption[],
) {
  const source = sources.find((entry) => entry.stageId === stage.id);
  if (!source) return [];
  if (source.participantSource.type === 'EXPLICIT_MEMBERS')
    return [...source.participantSource.memberIds];
  const included = new Set(source.participantSource.includeMemberIds ?? []);
  const excluded = new Set(source.participantSource.excludeMemberIds ?? []);
  const ranks = new Set<string>(source.participantSource.ranks);
  const excludedEmployees = new Set<string>(FINAL_2026_NON_BIDDER_EMPLOYEE_IDS);
  const selected = members
    .filter((member) => {
      const bidRank =
        member.employeeId === FINAL_2026_BLOOMFIELD.employeeId
          ? FINAL_2026_BLOOMFIELD.bidRank
          : member.rank;
      if (
        excludedEmployees.has(member.employeeId) ||
        member.bidCategory === 'EXCLUDED' ||
        !ranks.has(bidRank)
      )
        return false;
      return !['inactive', 'retired', 'separated'].includes(member.employmentStatus);
    })
    .map((member) => Number(member.value))
    .filter((memberId) => Number.isSafeInteger(memberId) && memberId > 0);
  for (const memberId of included) if (!selected.includes(memberId)) selected.push(memberId);
  return selected.filter((memberId) => !excluded.has(memberId));
}

/**
 * Converts the reviewed 2026 source package into a usable, editable working
 * configuration. Values not fixed by the source documents are deliberately
 * non-restrictive Mock assumptions and remain visible in the ordinary editor.
 * Source decisions are never resolved or reclassified here, so Real remains
 * blocked until the normal evidence review is complete.
 */
export function applyKnown2026Setup(
  content: BidDefinitionContent,
  members: readonly BidMemberOption[],
): Result {
  if (content.bidYear !== 2026)
    return { ok: false, message: 'The source-backed quick setup is only available for 2026.' };
  const pending = content.pendingPolicy;
  if (!pending) return { ok: false, message: 'The reviewed 2026 pending policy is not available.' };
  if (!pending.stageParticipantSources)
    return { ok: false, message: 'Saved participant-source rules are required for quick setup.' };
  const annual = pending.executionPolicy.annualOperations;
  if (!annual)
    return { ok: false, message: 'The reviewed 2026 annual operating policy is not available.' };

  const adminMemberIds: number[] = [];
  for (const employeeId of REQUIRED_2026_ADMIN_EMPLOYEE_IDS) {
    const matches = members.filter((member) => member.employeeId === employeeId);
    if (matches.length !== 1)
      return {
        ok: false,
        message:
          matches.length === 0
            ? `Required administrator employee ID ${employeeId} is missing from the member catalog.`
            : `Required administrator employee ID ${employeeId} is duplicated in the member catalog.`,
      };
    const memberId = Number(matches[0]?.value);
    if (!Number.isSafeInteger(memberId) || memberId <= 0)
      return {
        ok: false,
        message: `Administrator employee ID ${employeeId} has an invalid record.`,
      };
    adminMemberIds.push(memberId);
  }

  const swatMemberIds: number[] = [];
  for (const employeeId of FINAL_2026_SWAT_EMPLOYEE_IDS) {
    const matches = members.filter((member) => member.employeeId === employeeId);
    if (matches.length !== 1)
      return {
        ok: false,
        message:
          matches.length === 0
            ? `Required 2026 SWAT employee ID ${employeeId} is missing from the member catalog.`
            : `Required 2026 SWAT employee ID ${employeeId} is duplicated in the member catalog.`,
      };
    const memberId = Number(matches[0]?.value);
    if (!Number.isSafeInteger(memberId) || memberId <= 0)
      return { ok: false, message: `2026 SWAT employee ID ${employeeId} has an invalid record.` };
    swatMemberIds.push(memberId);
  }

  const stages = pending.executionPolicy.stages.map((stage) => ({
    ...stage,
    memberIds: stageMembers(stage, pending.stageParticipantSources ?? [], members),
  }));
  const emptyStage = stages.find((stage) => stage.memberIds.length === 0);
  if (emptyStage)
    return {
      ok: false,
      message: `${emptyStage.label} has no members matching its saved participant-source rule.`,
    };

  const stageParticipantSources = pending.stageParticipantSources.map((source) => ({
    ...source,
    participantSource: {
      type: 'EXPLICIT_MEMBERS' as const,
      memberIds: [...(stages.find((stage) => stage.id === source.stageId)?.memberIds ?? [])],
    },
  }));
  const specializedPositionIds = [
    ...new Set((annual.specialties ?? []).flatMap((specialty) => specialty.opportunityPositionIds)),
  ];
  const existingADayExecution = annual.aDay.execution;
  const specializedADayTimingException = {
    id: '2026-specialized-award-deferred-a-day',
    label: 'Specialized award A-Day at ordinary rank turn',
    timing: 'AFTER_POSITION_SELECTION' as const,
    sourceRef: '2026-09-24 administrator decision: specialized award A-Day timing',
    positionIds: specializedPositionIds,
    profileIds: [],
  };
  const policyResult = FrozenLiveBidPolicySchema.safeParse({
    ...pending.executionPolicy,
    stages,
    actionPermissions: pending.executionPolicy.actionPermissions.map((grant) => ({
      ...grant,
      actorMemberIds: [...adminMemberIds],
    })),
    annualOperations: {
      ...annual,
      membershipDistributions: [
        ...(annual.membershipDistributions ?? []).filter(
          (distribution) => distribution.id !== '2026-swat-medics',
        ),
        {
          id: '2026-swat-medics',
          label: '2026 SWAT Medics',
          sourceRef: 'Final July 2026 Bid Policy section 9 and 2026-09-24 approved roster',
          sourceDecisionId: '2026-09-24-swat-membership',
          membershipSource: 'REVIEWED_EXISTING_MEMBERS',
          memberIds: swatMemberIds,
          shifts: ['A', 'B', 'C'],
          minimumPerShift: 2,
          maximumPerShift: 2,
          maximumPerADay: 1,
        },
      ],
      contact: { ...annual.contact, minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION' },
      aDay: {
        ...annual.aDay,
        min: null,
        max: null,
        captainDcMax: null,
        specialtyMaximums: { ...annual.aDay.specialtyMaximums, MARINE_FLOAT: 2 },
        execution: {
          ...(existingADayExecution ?? {
            timing: 'SIMULTANEOUS' as const,
            officersPerGroup: null,
            sourceRef: 'Final July 2026 Bid Policy and 2026-09-24 administrator decisions',
            constraints: [],
          }),
          timingExceptions: [
            ...(existingADayExecution?.timingExceptions ?? []).filter(
              (exception) => exception.id !== specializedADayTimingException.id,
            ),
            ...(specializedPositionIds.length === 0 ? [] : [specializedADayTimingException]),
          ],
        },
      },
    },
  });
  if (!policyResult.success)
    return {
      ok: false,
      message: `The reviewed 2026 policy still has ${policyResult.error.issues.length} incomplete field(s): ${[
        ...new Set(policyResult.error.issues.map((issue) => issue.path.join('.'))),
      ]
        .slice(0, 8)
        .join(', ')}.`,
    };

  const { pendingPolicy: _pendingPolicy, ...remaining } = content;
  const candidate = BidDefinitionContentSchema.safeParse({
    ...remaining,
    settings: {
      v: 3,
      expectedDurationDays: 3,
      turnTimerSeconds: 300,
      credentialEvaluationOn: '2026-09-24',
      personnelEvaluationOn: '2026-09-24',
      livePolicy: policyResult.data,
    },
    policy: { ...pending, stageParticipantSources, executionPolicy: policyResult.data },
  });
  if (!candidate.success)
    return {
      ok: false,
      message: `The 2026 working setup could not be validated (${candidate.error.issues.length} issue(s)).`,
    };
  return { ok: true, content: candidate.data };
}

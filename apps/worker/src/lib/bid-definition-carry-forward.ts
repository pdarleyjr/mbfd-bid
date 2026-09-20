import {
  BidConfigurationSettingsV2Schema,
  type BidDefinitionContent,
  PendingLiveBidPolicySchema,
} from '@mbfd/shared';

const copiedReference = (sourceVersionId: string) =>
  `Copied structure from Bid version ${sourceVersionId}; annual review required.`;

type SourceExecutionPolicy = NonNullable<
  NonNullable<BidDefinitionContent['pendingPolicy']>['executionPolicy']
>;

function sourceExecutionPolicy(content: BidDefinitionContent): SourceExecutionPolicy | null {
  if (content.policy) return content.policy.executionPolicy;
  if (content.pendingPolicy) return content.pendingPolicy.executionPolicy;
  return content.settings?.v === 3 ? content.settings.livePolicy : null;
}

/**
 * A new annual cycle may reuse a configuration's vocabulary and structure, but
 * never its people, operator grants, approved ordering, selected evidence, or
 * session state. This produces a saved-but-non-executable authoring draft; the
 * ordinary review UI remains responsible for turning it into an executable
 * policy only after new annual decisions have been recorded.
 */
function pendingPolicyForNewAnnualBid(source: BidDefinitionContent, sourceVersionId: string) {
  const policy = sourceExecutionPolicy(source);
  if (policy === null) return null;
  const { orderingAuthority: _sourceOrderingAuthority, ...policyWithoutOrderingAuthority } = policy;
  const annual = policy.annualOperations;
  const annualOperations =
    annual === undefined
      ? undefined
      : (() => {
          // A reviewed membership distribution contains frozen people. Keep no
          // member identity in a future-year template; the administrator can
          // author and preview a new distribution through the normal workflow.
          const { membershipDistributions: _priorMemberships, ...withoutMemberships } = annual;
          const execution = withoutMemberships.aDay.execution;
          return {
            ...withoutMemberships,
            aDay: {
              ...withoutMemberships.aDay,
              ...(execution === undefined
                ? {}
                : {
                    execution: {
                      ...execution,
                      constraints: execution.constraints
                        .map((constraint) => ({ ...constraint, memberIds: [] }))
                        // A member-only limit has no reusable structural scope.
                        .filter(
                          (constraint) =>
                            constraint.positionIds.length > 0 || constraint.ranks.length > 0,
                        ),
                    },
                  }),
            },
          };
        })();
  return PendingLiveBidPolicySchema.parse({
    ...policyWithoutOrderingAuthority,
    policyRevision: `Carry-forward review required (${sourceVersionId})`,
    stages: policy.stages.map(({ participantProvenance: _provenance, ...stage }) => ({
      ...stage,
      memberIds: [],
    })),
    actionPermissions: policy.actionPermissions.map((grant) => ({
      ...grant,
      actorMemberIds: [],
    })),
    ...(annualOperations === undefined ? {} : { annualOperations }),
  });
}

export function carryForwardBidDefinitionStructure(input: {
  source: BidDefinitionContent;
  sourceVersionId: string;
  targetYear: number;
  personnelEvaluationOn: string;
  credentialEvaluationOn: string;
  expectedDurationDays: number;
  turnTimerSeconds: number;
}): BidDefinitionContent {
  const reference = copiedReference(input.sourceVersionId);
  const pending = pendingPolicyForNewAnnualBid(input.source, input.sourceVersionId);
  const participantSources =
    input.source.policy?.stageParticipantSources ??
    input.source.pendingPolicy?.stageParticipantSources;
  const reusableParticipantSources = (participantSources ?? []).filter(
    (definition) => definition.participantSource.type === 'FILTER',
  );
  return {
    v: 1,
    bidYear: input.targetYear,
    settings: BidConfigurationSettingsV2Schema.parse({
      v: 2,
      personnelEvaluationOn: input.personnelEvaluationOn,
      credentialEvaluationOn: input.credentialEvaluationOn,
      expectedDurationDays: input.expectedDurationDays,
      turnTimerSeconds: input.turnTimerSeconds,
    }),
    notes: input.source.notes,
    ...(pending === null
      ? {}
      : {
          pendingPolicy: {
            policyText:
              input.source.policy?.policyText ??
              input.source.pendingPolicy?.policyText ??
              'Copied operating structure requires new annual policy review.',
            executionPolicy: pending,
            ...(reusableParticipantSources.length > 0
              ? { stageParticipantSources: reusableParticipantSources }
              : {}),
          },
        }),
    policy: null,
    planning: {
      effectiveOn: input.personnelEvaluationOn,
      sourceSessionId: null,
      sourcePolicyText: reference,
    },
    authoring:
      input.source.authoring === null
        ? null
        : {
            ...input.source.authoring,
            profiles: input.source.authoring.profiles.map((profile) => ({
              ...profile,
              sourceRef: reference,
            })),
            // Reuse profiles and their concrete rules without claiming that an
            // old source approval covers the new cycle.
            reconciliation: 'RULES_CHANGED_AFTER_COMPILATION',
          },
    positions: input.source.positions,
    rules: input.source.rules,
    participation: input.source.participation.map((row) => ({
      ...row,
      authoritativeSourceRef: reference,
    })),
    staffingBindings: input.source.staffingBindings.map((row) => ({
      ...row,
      authoritativeSourceRef: reference,
      reviewStatus: 'draft',
    })),
    sourceDecisions: [
      {
        issueId: `carry-forward-${input.sourceVersionId}`,
        title: 'Annual carry-forward review',
        question: 'Which copied Bid structures remain approved for this new annual cycle?',
        area: 'annual-plan',
        status: 'OPEN',
        decision:
          'Saved structure is a non-executable starting point. Re-review participants, operators, evidence, policy approvals, and annual dates before activation.',
        sourceRef: reference,
        effectiveOn: input.personnelEvaluationOn,
        blockingClassification: 'BLOCKS_FINAL_2026_CONFIGURATION',
        affectedScopes: ['carry-forward', 'participants', 'operator-authority', 'annual-policy'],
      },
    ],
  };
}

export const carriedForwardStructureReviewItems = [
  'participants and explicit inclusions or exclusions',
  'operator action grants and step-up authorization',
  'ordering authority and annual source decisions',
  'credential and personnel evaluation dates',
  'membership distributions and member-specific A-Day constraints',
  'staffing bindings and current topology',
] as const;

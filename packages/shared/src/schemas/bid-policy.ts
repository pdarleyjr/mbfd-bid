import { z } from 'zod';
import { BIDDING_RANKS } from '../constants/ranks.js';
import { AnnualRuleProfileSchema } from './annual-rule-profile.js';
import { BidMembershipDistributionSchema } from './bid-membership-distribution.js';
import { BidOpportunityPoolsSchema } from './bid-opportunity-pool.js';
import { BidOrdinalKeySchema, FrozenBidOrdinalEvidenceSchema } from './bid-ordinal.js';
import { ConfiguredScoringSchema } from './configured-scoring.js';
import { FrozenServiceCreditSchema } from './service-evidence.js';

/**
 * Controls whether a canonical staffing slot participates in ordinary Bid
 * selection. A staffing record may remain active while being outside Bid.
 */
export const BidParticipationSchema = z.enum([
  'BIDDABLE',
  'ADMIN_ASSIGNED_NON_BIDDABLE',
  'RESERVED_NON_BIDDABLE',
]);
export type BidParticipation = z.infer<typeof BidParticipationSchema>;

/**
 * Live Bid access is intentionally action-scoped.  Hub administration grants
 * access to the Bid administration surface; it never implies operational
 * authority.  A frozen annual policy must name every live actor explicitly.
 */
export const LiveBidActionSchema = z.enum([
  'record_selection',
  'amend_selection',
  'skip_defer',
  'mark_unreachable',
  'force',
  'resolve_tie',
  'alter_order',
  'pause_resume',
  /** Creating a Managed Live session is separate from every in-session or post-Bid transition. */
  'create_live_session',
  'approve_transition',
  'approve_final_results',
  'publish',
]);
export type LiveBidAction = z.infer<typeof LiveBidActionSchema>;

/**
 * The July 2026 policy has one ordinary A-Day workflow and one defined
 * exception: Specialized Shift Positions may select later under the approved
 * Timeline.  A separate generic "stage" is the same state transition, and an
 * administrative assignment is an exceptional force action, not a timing
 * policy.  Keeping this vocabulary small prevents a configuration from
 * promising a workflow the canonical engine cannot represent.
 */
export const ADayExecutionTimingSchema = z.enum(['SIMULTANEOUS', 'AFTER_POSITION_SELECTION']);
export type ADayExecutionTiming = z.infer<typeof ADayExecutionTimingSchema>;

/** Historical frozen policies predate the explicit Managed-Live creation
 * action. They remain readable, but that omitted grant is always denied. */
const HistoricalLiveBidActions = LiveBidActionSchema.options.filter(
  (action) => action !== 'create_live_session',
);

export const BidDispositionSchema = z.enum([
  'HOLD',
  'PASS',
  'DEFER',
  'SKIP',
  'DECLINED',
  'UNREACHABLE',
]);
export type BidDisposition = z.infer<typeof BidDispositionSchema>;

/**
 * A specialty is annual policy material, not a client-supplied ranking. The
 * candidate pool is recalculated from the session's frozen evidence whenever
 * an interruption is opened.
 */
export const FrozenAnnualSpecialtyPolicySchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    mode: z.enum(['INTERRUPTING', 'PRIORITY_ONLY']),
    opportunityPositionIds: z.array(z.string().trim().min(1).max(160)).min(1),
    requiredCredentialNames: z.array(z.string().trim().min(1).max(160)),
    requiredSpecialtyCodes: z.array(z.string().trim().min(1).max(128)),
    scoring: ConfiguredScoringSchema.optional(),
    rankingChannel: z.enum(['total', 'so', 'mo']).optional(),
    points: z
      .array(
        z
          .object({
            credentialName: z.string().trim().min(1).max(160),
            value: z.number().int().min(0).max(10_000),
          })
          .strict(),
      )
      .max(100),
    tieBreakChain: z
      .array(
        z.enum([
          'POINTS',
          'RSC_SENIORITY',
          'RANK_SENIORITY',
          'TIME_IN_GRADE_BID_ORDINAL',
          'DEPARTMENT_SERVICE_BID_ORDINAL',
        ]),
      )
      .min(1)
      .max(3),
  })
  .strict()
  .superRefine((specialty, ctx) => {
    if ((specialty.scoring === undefined) !== (specialty.rankingChannel === undefined))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scoring'],
        message: 'Grouped specialty scoring and its ranking channel must be configured together',
      });
    if (specialty.scoring && specialty.points.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['points'],
        message: 'Grouped specialty scoring replaces legacy flat points; both cannot be active',
      });
    if (new Set(specialty.opportunityPositionIds).size !== specialty.opportunityPositionIds.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['opportunityPositionIds'],
        message: 'specialty opportunity positions must be unique',
      });
    if (
      new Set(specialty.requiredCredentialNames).size !== specialty.requiredCredentialNames.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiredCredentialNames'],
        message: 'specialty credentials must be unique',
      });
    if (new Set(specialty.requiredSpecialtyCodes).size !== specialty.requiredSpecialtyCodes.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiredSpecialtyCodes'],
        message: 'specialty qualification codes must be unique',
      });
    if (
      new Set(specialty.points.map((entry) => entry.credentialName)).size !==
      specialty.points.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['points'],
        message: 'a credential may have only one specialty point value',
      });
    if (new Set(specialty.tieBreakChain).size !== specialty.tieBreakChain.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tieBreakChain'],
        message: 'specialty tiebreak entries must be unique',
      });
  });
export type FrozenAnnualSpecialtyPolicy = z.infer<typeof FrozenAnnualSpecialtyPolicySchema>;

/**
 * Immutable execution facts needed after an annual configuration is frozen.
 * These are deliberately configuration data, not inferred from historical
 * rosters or current staffing. Missing values therefore block real execution.
 */
export const FrozenAnnualOperationsPolicySchema = z
  .object({
    v: z.literal(1),
    stageOrder: z.array(z.string().trim().min(1).max(80)).min(1),
    /** Dedicated specialty seats must be named in frozen topology, never inferred from staffing. */
    requiredTopologyPositionIds: z.array(z.string().trim().min(1).max(160)).min(1),
    specialties: z.array(FrozenAnnualSpecialtyPolicySchema).max(100).optional(),
    opportunityPools: BidOpportunityPoolsSchema.optional(),
    membershipDistributions: z.array(BidMembershipDistributionSchema).max(100).optional(),
    assignmentTerms: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            positionIds: z.array(z.string().trim().min(1).max(160)).min(1),
            requiredServiceMonths: z.number().int().min(1).max(1_200),
            reopenAfterConsecutiveCycles: z.number().int().min(1).max(100),
            closedForThisBid: z.boolean(),
            sourceRef: z.string().trim().min(4).max(500),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    fallbackPolicies: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(160),
            sourceRef: z.string().trim().min(4).max(500),
            sourceDecisionId: z.string().trim().min(1).max(160),
            positionIds: z.array(z.string().trim().min(1).max(160)).min(1),
            tiers: z
              .array(
                z
                  .object({
                    id: z.string().trim().min(1).max(80),
                    label: z.string().trim().min(1).max(160),
                    mode: z.enum(['VOLUNTARY', 'FORCED']),
                    eligibility: z.discriminatedUnion('kind', [
                      z.object({ kind: z.literal('MINIMUM_QUALIFIED') }).strict(),
                      z
                        .object({
                          kind: z.literal('EXPLICIT_REQUIREMENTS'),
                          requirements: AnnualRuleProfileSchema.shape.requirements,
                        })
                        .strict(),
                    ]),
                    currentlyAssignedOnly: z.boolean(),
                    historyPredicate: z
                      .object({
                        kind: z.literal('NO_COMPLETED_DAYS_BID_TOUR'),
                        sourceRef: z.string().trim().min(4).max(500),
                      })
                      .strict()
                      .optional(),
                    comparator: z
                      .array(
                        z
                          .object({
                            key: BidOrdinalKeySchema,
                            direction: z.enum(['ASC', 'DESC']),
                          })
                          .strict(),
                      )
                      .min(1)
                      .max(2),
                  })
                  .strict(),
              )
              .min(1)
              .max(10),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    contact: z
      .object({
        minimumAttempts: z.number().int().min(0).max(10),
        timingMode: z.enum(['HARD_MINIMUM', 'TARGET', 'OPERATOR_DISCRETION']),
        durationSeconds: z.number().int().min(0).max(86_400).nullable(),
        /** Explicit annual evidence policy; omitted only for pre-editor recovery material. */
        evidenceRequired: z.boolean().optional(),
      })
      .strict()
      .superRefine((contact, ctx) => {
        if (contact.timingMode !== 'OPERATOR_DISCRETION' && contact.durationSeconds === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['durationSeconds'],
            message: 'hard-minimum and target contact timing require an explicit duration',
          });
        }
      }),
    aDay: z
      .object({
        /** The established group identifiers are stable; annual availability is not. */
        combatGroups: z
          .array(z.enum(['G1', 'G2', 'G3', 'G4']))
          .min(1)
          .max(4)
          .refine((groups) => new Set(groups).size === groups.length, {
            message: 'A-Day combat groups must be unique',
          }),
        min: z.number().int().min(0).max(1_000),
        max: z.number().int().min(0).max(1_000),
        captainDcMax: z.number().int().min(0).max(1_000),
        /** Explicit execution policy for new versions; old snapshots are unchanged. */
        execution: z
          .object({
            timing: ADayExecutionTimingSchema,
            /**
             * A profile reference is preserved as annual authoring provenance;
             * position ids are the frozen execution scope.  A profile may be
             * renamed or removed after this version is sealed, so execution
             * never has to rediscover its members or opportunities.
             */
            timingExceptions: z
              .array(
                z
                  .object({
                    id: z.string().trim().min(1).max(80),
                    label: z.string().trim().min(1).max(160),
                    timing: ADayExecutionTimingSchema,
                    sourceRef: z.string().trim().min(4).max(500),
                    /** Candidate review resolves profile provenance to this frozen scope. */
                    positionIds: z.array(z.string().trim().min(1).max(160)).max(500),
                    profileIds: z.array(z.string().trim().min(1).max(160)).max(250),
                  })
                  .strict()
                  .refine((rule) => rule.positionIds.length + rule.profileIds.length > 0, {
                    message:
                      'A-Day timing exceptions require an opportunity or shared profile scope',
                  }),
              )
              .max(100)
              .optional(),
            officersPerGroup: z.number().int().min(0).max(1_000).nullable(),
            sourceRef: z.string().trim().min(4).max(500),
            constraints: z
              .array(
                z
                  .object({
                    shifts: z.array(z.enum(['A', 'B', 'C', 'D'])).min(1),
                    id: z.string().trim().min(1).max(80),
                    label: z.string().trim().min(1).max(160),
                    sourceRef: z.string().trim().min(4).max(500),
                    maximum: z.number().int().min(0).max(1_000),
                    positionIds: z.array(z.string().trim().min(1).max(160)),
                    memberIds: z.array(z.number().int().positive()),
                    ranks: z.array(z.enum(['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF'])),
                  })
                  .strict()
                  .refine(
                    (rule) =>
                      rule.positionIds.length + rule.memberIds.length + rule.ranks.length > 0,
                    {
                      message: 'A-Day constraints require an explicit scope',
                    },
                  ),
              )
              .max(100),
          })
          .strict()
          .optional(),
        specialtyMaximums: z
          .object({
            MARINE_ASSIGNED: z.number().int().min(0).max(1_000),
            MARINE_FLOAT: z.number().int().min(0).max(1_000),
            DE: z.number().int().min(0).max(1_000),
            SWAT: z.number().int().min(0).max(1_000),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (new Set(policy.stageOrder).size !== policy.stageOrder.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stageOrder'],
        message: 'annual stage ids must be unique',
      });
    }
    if (
      new Set(policy.requiredTopologyPositionIds).size !== policy.requiredTopologyPositionIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiredTopologyPositionIds'],
        message: 'annual specialty topology position ids must be unique',
      });
    }
    if (policy.aDay.min > policy.aDay.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aDay'],
        message: 'A-Day minimum cannot exceed maximum',
      });
    }
    const constraints = policy.aDay.execution?.constraints ?? [];
    const timingExceptions = policy.aDay.execution?.timingExceptions ?? [];
    if (new Set(constraints.map((rule) => rule.id)).size !== constraints.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aDay', 'execution', 'constraints'],
        message: 'A-Day constraint identities must be unique',
      });
    if (new Set(timingExceptions.map((rule) => rule.id)).size !== timingExceptions.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aDay', 'execution', 'timingExceptions'],
        message: 'A-Day timing exception identities must be unique',
      });
    for (const [index, rule] of timingExceptions.entries()) {
      for (const key of ['positionIds', 'profileIds'] as const) {
        if (new Set(rule[key]).size !== rule[key].length)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['aDay', 'execution', 'timingExceptions', index, key],
            message: 'A-Day timing exception scope entries must be unique',
          });
      }
    }
    const timingExceptionByPosition = new Map<string, number>();
    for (const [index, rule] of timingExceptions.entries()) {
      for (const positionId of rule.positionIds) {
        const existing = timingExceptionByPosition.get(positionId);
        if (existing !== undefined)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['aDay', 'execution', 'timingExceptions', index, 'positionIds'],
            message: `Opportunity ${positionId} is already governed by A-Day timing exception ${existing + 1}`,
          });
        else timingExceptionByPosition.set(positionId, index);
      }
    }
    for (const [index, rule] of constraints.entries()) {
      for (const key of ['positionIds', 'memberIds', 'ranks', 'shifts'] as const) {
        if (new Set<string | number>(rule[key]).size !== rule[key].length)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['aDay', 'execution', 'constraints', index, key],
            message: 'A-Day scope entries must be unique',
          });
      }
    }
    const terms = policy.assignmentTerms ?? [];
    const distributions = policy.membershipDistributions ?? [];
    if (new Set(distributions.map((entry) => entry.id)).size !== distributions.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['membershipDistributions'],
        message: 'Membership distribution identities must be unique',
      });
    const termPositions = terms.flatMap((term) => term.positionIds);
    if (
      new Set(terms.map((term) => term.id)).size !== terms.length ||
      new Set(termPositions).size !== termPositions.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignmentTerms'],
        message: 'Assignment term identities must be unique and opportunity scopes cannot overlap',
      });
    const specialtyIds = policy.specialties?.map((specialty) => specialty.id) ?? [];
    const fallbacks = policy.fallbackPolicies ?? [];
    if (
      new Set(fallbacks.map((entry) => entry.id)).size !== fallbacks.length ||
      fallbacks.some(
        (entry) => new Set(entry.tiers.map((tier) => tier.id)).size !== entry.tiers.length,
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fallbackPolicies'],
        message: 'Fallback policy and tier identities must be unique',
      });
    const fallbackPositions = fallbacks.flatMap((entry) => entry.positionIds);
    for (const [index, fallback] of fallbacks.entries()) {
      for (const [tierIndex, tier] of fallback.tiers.entries()) {
        if (new Set(tier.comparator.map((rule) => rule.key)).size !== tier.comparator.length)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['fallbackPolicies', index, 'tiers', tierIndex, 'comparator'],
            message: 'Fallback comparator keys must be unique',
          });
      }
    }
    if (new Set(fallbackPositions).size !== fallbackPositions.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fallbackPolicies'],
        message: 'Each opportunity can have only one fallback policy',
      });
    if (new Set(specialtyIds).size !== specialtyIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specialties'],
        message: 'annual specialty ids must be unique',
      });
    }
  });
export type FrozenAnnualOperationsPolicy = z.infer<typeof FrozenAnnualOperationsPolicySchema>;

/**
 * Authoring selects from the Department context only through these typed
 * predicates. They deliberately have no expression, SQL, or executable-code
 * escape hatch. A FILTER source carries the safe, affirmative values that can
 * be resolved against a pinned Bid evaluation; it never means "look up whoever
 * is currently active" during a running session.
 */
const StageParticipantMemberIdsSchema = z
  .array(z.number().int().positive())
  .max(10_000)
  .refine((memberIds) => new Set(memberIds).size === memberIds.length, {
    message: 'stage member ids must be unique',
  });

export const StageParticipantSourceSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('EXPLICIT_MEMBERS'),
        memberIds: z
          .array(z.number().int().positive())
          .min(1)
          .max(10_000)
          .refine((memberIds) => new Set(memberIds).size === memberIds.length, {
            message: 'explicit stage member ids must be unique',
          }),
      })
      .strict(),
    z
      .object({
        type: z.literal('FILTER'),
        active: z.literal(true),
        bidParticipation: z.literal('BIDDABLE'),
        ranks: z
          .array(z.enum(BIDDING_RANKS))
          .min(1)
          .max(BIDDING_RANKS.length)
          .refine((ranks) => new Set(ranks).size === ranks.length, {
            message: 'stage filter ranks must be unique',
          }),
        /** Explicit exceptions are still resolved only from a pinned evaluation. */
        includeMemberIds: StageParticipantMemberIdsSchema.optional(),
        excludeMemberIds: StageParticipantMemberIdsSchema.optional(),
      })
      .strict(),
  ])
  .superRefine((source, ctx) => {
    if (source.type !== 'FILTER') return;
    const included = new Set(source.includeMemberIds ?? []);
    const overlap = (source.excludeMemberIds ?? []).find((memberId) => included.has(memberId));
    if (overlap !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['excludeMemberIds'],
        message: 'stage filter member exceptions cannot include and exclude the same member',
      });
  });
export type StageParticipantSource = z.infer<typeof StageParticipantSourceSchema>;

export const StageParticipantOrderingRuleSchema = z
  .object({
    key: BidOrdinalKeySchema,
    direction: z.enum(['ASC', 'DESC']),
  })
  .strict();
export type StageParticipantOrderingRule = z.infer<typeof StageParticipantOrderingRuleSchema>;

/** A selector requires an explicit, deterministic ordering contract. */
export const StageParticipantOrderingSchema = z
  .array(StageParticipantOrderingRuleSchema)
  .min(1)
  .max(2)
  .refine((ordering) => new Set(ordering.map((rule) => rule.key)).size === ordering.length, {
    message: 'stage participant ordering keys must be unique',
  });
export type StageParticipantOrdering = z.infer<typeof StageParticipantOrderingSchema>;

/** The governing annual comparator can use the same explicit, deterministic
 * ordering shape as a stage. It is not authoritative by itself: a frozen
 * source-decision identity is required before Live may use it. */
export const BidOrderingComparatorSchema = StageParticipantOrderingSchema;
export type BidOrderingComparator = z.infer<typeof BidOrderingComparatorSchema>;

export const BidStageComparatorsSchema = z
  .array(
    z
      .object({
        stageId: z.string().trim().min(1).max(80),
        comparator: BidOrderingComparatorSchema,
      })
      .strict(),
  )
  .min(1)
  .max(100)
  .refine(
    (stages) => new Set(stages.map((stage) => stage.stageId)).size === stages.length,
    'Ordering requires unique stage identities',
  );

/** V1 remains byte-compatible. V2 never falls back to another stage's order. */
export function bidOrderingComparatorForStage(
  authority:
    | { v: 1; comparator: BidOrderingComparator }
    | { v: 2; stages: z.infer<typeof BidStageComparatorsSchema> }
    | undefined,
  stageId: string,
): BidOrderingComparator | undefined {
  return authority?.v === 1
    ? authority.comparator
    : authority?.stages.find((stage) => stage.stageId === stageId)?.comparator;
}

const FrozenPolicyCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'must be an ISO calendar date');

/** A comparator becomes execution material only after a separate, resolved
 * source decision has been matched and frozen. Free-form source references
 * and a comparator enum alone are deliberately insufficient. */
const LegacyFrozenBidOrderingAuthoritySchema = z
  .object({
    v: z.literal(1),
    comparator: BidOrderingComparatorSchema,
    sourceDecision: z
      .object({
        issueId: z.string().trim().min(1).max(200),
        effectiveOn: FrozenPolicyCalendarDateSchema,
      })
      .strict(),
  })
  .strict();
export const FrozenBidOrderingAuthoritySchema = z.discriminatedUnion('v', [
  LegacyFrozenBidOrderingAuthoritySchema,
  z
    .object({
      v: z.literal(2),
      stages: BidStageComparatorsSchema,
      sourceDecision: LegacyFrozenBidOrderingAuthoritySchema.shape.sourceDecision,
    })
    .strict(),
]);
export type FrozenBidOrderingAuthority = z.infer<typeof FrozenBidOrderingAuthoritySchema>;

/** Saved-definition authoring data. The source reference survives resolution
 * so an operator can trace frozen membership to reviewed policy material. */
export const StageParticipantSourceDefinitionSchema = z
  .object({
    stageId: z.string().trim().min(1).max(80),
    sourceRef: z.string().trim().min(4).max(500),
    participantSource: StageParticipantSourceSchema,
    ordering: StageParticipantOrderingSchema,
  })
  .strict();
export type StageParticipantSourceDefinition = z.infer<
  typeof StageParticipantSourceDefinitionSchema
>;

export const StageParticipantSourceDefinitionsSchema = z
  .array(StageParticipantSourceDefinitionSchema)
  .min(1)
  .max(100)
  .refine(
    (definitions) =>
      new Set(definitions.map((definition) => definition.stageId)).size === definitions.length,
    { message: 'stage participant source definitions require unique stage ids' },
  );
export type StageParticipantSourceDefinitions = z.infer<
  typeof StageParticipantSourceDefinitionsSchema
>;

/**
 * Frozen evidence of how a stage's already-explicit memberIds were resolved.
 * The runtime consumes memberIds only; this provenance is audit material and
 * cannot trigger a current-roster query.
 */
export const FrozenStageParticipantProvenanceSchema = z
  .object({
    v: z.literal(1),
    stageId: z.string().trim().min(1).max(80),
    sourceRef: z.string().trim().min(4).max(500),
    participantSource: StageParticipantSourceSchema,
    ordering: StageParticipantOrderingSchema,
    /** Present only when the policy-level governing comparator has been
     * independently resolved and frozen for this run. */
    orderingAuthority: FrozenBidOrderingAuthoritySchema.optional(),
    pinnedEvaluationCapturedAtMs: z.number().int().nonnegative(),
    resolvedMemberIds: z.array(z.number().int().positive()).min(1),
  })
  .strict();
export type FrozenStageParticipantProvenance = z.infer<
  typeof FrozenStageParticipantProvenanceSchema
>;

const FrozenLiveStageSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    order: z.number().int().nonnegative(),
    /** Explicit member ids avoid implicit rank/title/employee-id authority. */
    memberIds: z.array(z.number().int().positive()).min(1),
    /** Explicit opportunity filtering; a reserved vacancy is never inferred. */
    opportunityPositionIds: z.array(z.string().trim().min(1)).min(1),
    /** Substages are represented by separate, explicitly ordered stage rows. */
    kind: z.enum(['D_SHIFT', 'CAPTAIN', 'LIEUTENANT', 'FIREFIGHTER', 'MIXED']),
    /** Optional so historical and explicit-member policies remain readable. */
    participantProvenance: FrozenStageParticipantProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((stage, context) => {
    const provenance = stage.participantProvenance;
    if (
      provenance !== undefined &&
      (provenance.stageId !== stage.id ||
        JSON.stringify(provenance.resolvedMemberIds) !== JSON.stringify(stage.memberIds))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participantProvenance'],
        message: 'stage participant provenance must describe this exact frozen member list',
      });
    }
  });
export type FrozenLiveStage = z.infer<typeof FrozenLiveStageSchema>;

const FrozenDispositionRuleSchema = z
  .object({
    disposition: BidDispositionSchema,
    advances: z.boolean(),
    returns: z.boolean(),
    returnStageId: z.string().trim().min(1).max(80).nullable(),
    retainsLaterSelectionRights: z.boolean(),
    terminal: z.boolean(),
    requiresReason: z.boolean(),
    requiresEvidence: z.boolean(),
    contactPolicyReference: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.returns !== (rule.returnStageId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['returnStageId'],
        message: 'a return requires an explicit return stage, and no-return cannot name one',
      });
    }
  });
export type FrozenDispositionRule = z.infer<typeof FrozenDispositionRuleSchema>;

const LiveActionPermissionSchema = z
  .object({
    action: LiveBidActionSchema,
    actorMemberIds: z.array(z.number().int().positive()).min(1),
  })
  .strict();

/**
 * Annual live policy captured into a session. No policy field has an implicit
 * default: missing grants, stages, or disposition rows must block live work.
 */
export const FrozenLiveBidPolicySchema = z
  .object({
    v: z.literal(1),
    policyRevision: z.string().trim().min(1).max(200),
    stages: z.array(FrozenLiveStageSchema).min(1),
    /** This is generated from a resolved saved-definition decision, not taken
     * from a stage source reference or a bare comparator selection. */
    orderingAuthority: FrozenBidOrderingAuthoritySchema.optional(),
    dispositions: z.array(FrozenDispositionRuleSchema).length(6),
    actionPermissions: z
      .array(LiveActionPermissionSchema)
      .min(HistoricalLiveBidActions.length)
      .max(LiveBidActionSchema.options.length),
    specialtyCatalogReference: z.string().trim().min(1).max(200).nullable(),
    aDayPolicyReference: z.string().trim().min(1).max(200).nullable(),
    /** Omitted only for pre-Annual-Operations sessions; live operations then fail closed. */
    annualOperations: FrozenAnnualOperationsPolicySchema.optional(),
    transitionPolicyReference: z.string().trim().min(1).max(200).nullable(),
    publicationPolicyReference: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.orderingAuthority?.v === 2 &&
      (policy.orderingAuthority.stages.length !== policy.stages.length ||
        policy.stages.some(
          (stage) =>
            bidOrderingComparatorForStage(policy.orderingAuthority, stage.id) === undefined,
        ))
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orderingAuthority'],
        message: 'Contextual ordering must cover every frozen stage exactly.',
      });
    const stageIds = new Set<string>();
    const stageOrders = new Set<number>();
    const memberIds = new Set<number>();
    for (const [index, stage] of policy.stages.entries()) {
      if (stageIds.has(stage.id) || stageOrders.has(stage.order)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', index],
          message: 'stages require unique ids and order',
        });
      }
      stageIds.add(stage.id);
      stageOrders.add(stage.order);
      if (
        stage.participantProvenance?.orderingAuthority !== undefined &&
        JSON.stringify(stage.participantProvenance.orderingAuthority) !==
          JSON.stringify(policy.orderingAuthority)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', index, 'participantProvenance', 'orderingAuthority'],
          message: 'stage ordering authority must exactly match the frozen policy authority',
        });
      }
      if (
        stage.participantProvenance?.orderingAuthority !== undefined &&
        JSON.stringify(stage.participantProvenance.ordering) !==
          JSON.stringify(bidOrderingComparatorForStage(policy.orderingAuthority, stage.id))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', index, 'participantProvenance', 'ordering'],
          message: 'stage ordering must exactly match the frozen governing comparator',
        });
      }
      for (const memberId of stage.memberIds) {
        if (memberIds.has(memberId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['stages', index, 'memberIds'],
            message: 'a member may occur in only one frozen stage',
          });
        }
        memberIds.add(memberId);
      }
    }
    const dispositions = new Set(policy.dispositions.map((rule) => rule.disposition));
    if (dispositions.size !== 6) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dispositions'],
        message: 'every disposition requires one deterministic rule',
      });
    }
    const actions = new Set(policy.actionPermissions.map((grant) => grant.action));
    const missingHistoricalAction = HistoricalLiveBidActions.some((action) => !actions.has(action));
    const isCurrentPolicy = policy.actionPermissions.length === LiveBidActionSchema.options.length;
    if (
      actions.size !== policy.actionPermissions.length ||
      missingHistoricalAction ||
      (isCurrentPolicy && !actions.has('create_live_session'))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actionPermissions'],
        message:
          'every historical live action requires one explicit grant row; current policies also require create_live_session',
      });
    }
    for (const rule of policy.dispositions) {
      if (rule.returnStageId !== null && !stageIds.has(rule.returnStageId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dispositions'],
          message: 'return stage must be a frozen stage id',
        });
      }
    }
  });
export type FrozenLiveBidPolicy = z.infer<typeof FrozenLiveBidPolicySchema>;
const PendingAnnualOperationsBase = FrozenAnnualOperationsPolicySchema.innerType();
const PendingADayBase = PendingAnnualOperationsBase.shape.aDay;
const PendingAnnualOperationsSchema = PendingAnnualOperationsBase.extend({
  contact: PendingAnnualOperationsBase.shape.contact.innerType().extend({
    minimumAttempts: PendingAnnualOperationsBase.shape.contact
      .innerType()
      .shape.minimumAttempts.nullable(),
  }),
  aDay: PendingADayBase.extend({
    min: PendingADayBase.shape.min.nullable(),
    max: PendingADayBase.shape.max.nullable(),
    captainDcMax: PendingADayBase.shape.captainDcMax.nullable(),
    specialtyMaximums: PendingADayBase.shape.specialtyMaximums.extend({
      MARINE_FLOAT: PendingADayBase.shape.specialtyMaximums.shape.MARINE_FLOAT.nullable(),
    }),
  }),
});
/** Saved, unresolved authoring only. Runtime snapshots always use the strict
 * Frozen schema above; empty identities confer no authority or participation. */
export const PendingLiveBidPolicySchema = FrozenLiveBidPolicySchema.innerType()
  .extend({
    stages: z
      .array(
        FrozenLiveStageSchema.innerType().extend({
          memberIds: z.array(z.number().int().positive()),
        }),
      )
      .min(1),
    actionPermissions: z
      .array(
        LiveActionPermissionSchema.extend({ actorMemberIds: z.array(z.number().int().positive()) }),
      )
      .min(HistoricalLiveBidActions.length)
      .max(LiveBidActionSchema.options.length),
    annualOperations: PendingAnnualOperationsSchema.optional(),
  })
  .superRefine((policy, ctx) => {
    const frozen = FrozenLiveBidPolicySchema.safeParse(policy);
    if (frozen.success) return;
    for (const issue of frozen.error.issues) {
      const unresolvedIds =
        issue.code === 'too_small' &&
        issue.path.length === 3 &&
        ((issue.path[0] === 'stages' && issue.path[2] === 'memberIds') ||
          (issue.path[0] === 'actionPermissions' && issue.path[2] === 'actorMemberIds'));
      const unresolvedNumeric =
        issue.code === 'invalid_type' &&
        issue.received === 'null' &&
        [
          'annualOperations.contact.minimumAttempts',
          'annualOperations.aDay.min',
          'annualOperations.aDay.max',
          'annualOperations.aDay.captainDcMax',
          'annualOperations.aDay.specialtyMaximums.MARINE_FLOAT',
        ].includes(issue.path.join('.'));
      if (!unresolvedIds && !unresolvedNumeric) ctx.addIssue(issue);
    }
  });
export type PendingLiveBidPolicy = z.infer<typeof PendingLiveBidPolicySchema>;

/** No actor can inherit live authority from a Hub-admin role or rank. */
export function isLiveBidActionAuthorized(
  policy: FrozenLiveBidPolicy | null | undefined,
  action: LiveBidAction,
  actorMemberId: number | null | undefined,
): boolean {
  if (
    policy === null ||
    policy === undefined ||
    actorMemberId === null ||
    actorMemberId === undefined
  ) {
    return false;
  }
  return policy.actionPermissions.some(
    (permission) =>
      permission.action === action && permission.actorMemberIds.includes(actorMemberId),
  );
}

export const FrozenBidPoolMemberSchema = z
  .object({
    memberId: z.number().int().positive(),
    pool: z.enum(['OFC', 'FF', 'EXCLUDED']),
    rscSeniority: z.number().int().nonnegative(),
    rankSeniority: z.number().int().nonnegative().nullable(),
    bidOrdinalEvidence: FrozenBidOrdinalEvidenceSchema.optional(),
    exclusionReason: z
      .enum([
        'ADMIN_ASSIGNED_NON_BIDDABLE',
        'MEMBER_CATEGORY_EXCLUDED',
        'MEMBER_NOT_ACTIVE',
        'MEMBER_EMPLOYMENT_UNCONFIRMED',
      ])
      .nullable(),
    authoritativeAssignmentId: z.string().min(1).nullable(),
    /**
     * Present only when a mock session admits an otherwise unconfirmed member
     * from the one accepted annual staffing baseline. It is deliberately
     * source-safe and must never be interpreted as a personnel correction.
     */
    mockParticipationEvidence: z.enum(['ACCEPTED_STAFFING_BASELINE']).optional(),
  })
  .strict();
export type FrozenBidPoolMember = z.infer<typeof FrozenBidPoolMemberSchema>;

/**
 * Source-safe specialty evidence frozen for a V3 session. It deliberately
 * retains only the deterministic policy facts: no source-system reference,
 * actor, reason, or raw evidence payload is copied into a Bid snapshot.
 */
export const FrozenSpecialtyQualificationSchema = z
  .object({
    specialtyCode: z.string().trim().min(1).max(128),
    status: z.enum(['active', 'expired', 'revoked', 'removed']),
    effectiveOn: FrozenPolicyCalendarDateSchema,
    expiresOn: FrozenPolicyCalendarDateSchema.nullable(),
  })
  .strict()
  .superRefine((qualification, ctx) => {
    if (qualification.expiresOn !== null && qualification.expiresOn < qualification.effectiveOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresOn'],
        message: 'specialty expiration cannot precede the effective date',
      });
    }
    if (qualification.status === 'expired' && qualification.expiresOn === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresOn'],
        message: 'an expired specialty qualification requires its expiration date',
      });
    }
    if (
      (qualification.status === 'revoked' || qualification.status === 'removed') &&
      qualification.expiresOn !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresOn'],
        message: 'revoked or removed specialty qualifications cannot carry an expiration date',
      });
    }
  });
export type FrozenSpecialtyQualification = z.infer<typeof FrozenSpecialtyQualificationSchema>;

/**
 * The deterministic eligibility inputs for a session member. These are kept
 * separate from employee identity so a session snapshot can reproduce policy
 * decisions without persisting names or source-system identifiers.
 */
export const FrozenBidEligibilityMemberSchema = FrozenBidPoolMemberSchema.extend({
  bidTourEvidence: z
    .object({
      recordId: z.string().min(1),
      effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      completedDaysTour: z.boolean().nullable(),
      sourceRef: z.string().min(4),
    })
    .strict()
    .optional(),
  /** Permission is frozen evidence, not an election to leave the retained assignment. */
  termParticipation: z
    .object({
      assignmentId: z.string().min(1),
      staffingPositionId: z.string().min(1),
      positionId: z.string().min(1),
      termId: z.string().min(1),
      evidenceId: z.string().min(1),
      evidenceRevision: z.number().int().positive(),
      sourceRef: z.string().min(4),
      evaluatedOn: FrozenPolicyCalendarDateSchema,
      assignmentEffectiveFrom: FrozenPolicyCalendarDateSchema,
      assignmentEffectiveTo: FrozenPolicyCalendarDateSchema.nullable(),
      memberMayLeave: z.literal(true),
      protected: z.boolean(),
      voluntaryOnly: z.literal(true),
    })
    .strict()
    .optional(),
  currentBidPositionIds: z.array(z.string().min(1)).optional(),
  rank: z.enum(['CIVILIAN', 'CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF']),
  isProbationary: z.boolean(),
  credentialNames: z.array(z.string().trim().min(1)),
  scoringEvidence: z
    .object({
      evaluationOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      completedCredentialNames: z.array(z.string().trim().min(1)),
    })
    .strict()
    .optional(),
  serviceCredits: z.array(FrozenServiceCreditSchema).optional(),
  /**
   * Optional only for pre-bridge V3 recovery snapshots. Fresh snapshots
   * always materialize the collection, including an empty collection; a
   * consumer must not treat an absent collection as evidence of eligibility.
   */
  specialtyQualifications: z.array(FrozenSpecialtyQualificationSchema).optional(),
})
  .strict()
  .superRefine((member, context) => {
    if (member.rank === 'CIVILIAN' && member.pool !== 'EXCLUDED') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pool'],
        message: 'civilian personnel must remain excluded from the annual bid pool',
      });
    }
  });
export type FrozenBidEligibilityMember = z.infer<typeof FrozenBidEligibilityMemberSchema>;

/**
 * A lossless, normalized copy of a rule row. Fresh snapshots retain these
 * fields rather than pointing back at a mutable draft rule book.
 */
export const FrozenRuleBookRuleSchema = z
  .object({
    ruleBookVersion: z.string().min(1),
    positionId: z.string().min(1),
    templateVersion: z.string().min(1),
    requiredCriteriaJson: z.string(),
    pointsPreferenceJson: z.string(),
    tieBreakChainJson: z.string(),
  })
  .strict();
export type FrozenRuleBookRule = z.infer<typeof FrozenRuleBookRuleSchema>;

/**
 * Versioned participation, legacy-count flags, and non-PII template display
 * fields needed to replay or export a session without consulting mutable
 * position records.
 */
export const FrozenRuleBookPositionSchema = z
  .object({
    id: z.string().min(1),
    templateVersion: z.string().min(1),
    bidParticipation: BidParticipationSchema,
    isExcludedFromCount: z.boolean(),
    shift: z.enum(['A', 'B', 'C', 'D']),
    station: z.string().trim().min(1),
    unit: z.string().trim().min(1),
    rankRequired: z.enum(['FF', 'LT', 'CPT', 'DC']),
    positionName: z.string().trim().min(1),
    /** Optional for older snapshots. Missing facts cannot be inferred when cloning. */
    division: z.string().trim().min(1).optional(),
    isFloating: z.boolean().optional(),
    isVacantByDesign: z.boolean().optional(),
  })
  .strict();
export type FrozenRuleBookPosition = z.infer<typeof FrozenRuleBookPositionSchema>;

/**
 * One immutable, replayable source for the deterministic rule coverage used
 * by a session. Decoding and coverage validation are repeated on every load;
 * this is intentionally material, not a reference to an editable draft.
 */
export const FrozenRuleBookMaterialSchema = z
  .object({
    v: z.literal(1),
    rules: z.array(FrozenRuleBookRuleSchema).min(1),
    positions: z.array(FrozenRuleBookPositionSchema).min(1),
  })
  .strict();
export type FrozenRuleBookMaterial = z.infer<typeof FrozenRuleBookMaterialSchema>;

/**
 * Supported year-level settings that must stay identical between mock and
 * eventual live sessions. Raw `bid_years.config_json` is never trusted until
 * it parses through this schema.
 */
/** Immutable calendar date selected by an operator for credential evidence evaluation. */
export const CredentialEvaluationDateSchema = FrozenPolicyCalendarDateSchema;

/**
 * Legacy settings remain readable for historical recovery and operator review,
 * but cannot configure a new session because they omit the explicit evidence
 * evaluation date introduced in V2.
 */
export const BidConfigurationSettingsV1Schema = z
  .object({
    v: z.literal(1),
    expectedDurationDays: z.number().int().min(1).max(7),
    turnTimerSeconds: z.number().int().min(30).max(600),
  })
  .strict();
export type BidConfigurationSettingsV1 = z.infer<typeof BidConfigurationSettingsV1Schema>;

/**
 * Every newly designated annual configuration explicitly fixes the calendar
 * date used to evaluate credential lifecycle evidence. This avoids using a
 * later mock/session creation timestamp as an implicit policy decision.
 */
export const BidConfigurationSettingsV2Schema = z
  .object({
    v: z.literal(2),
    expectedDurationDays: z.number().int().min(1).max(7),
    turnTimerSeconds: z.number().int().min(30).max(600),
    credentialEvaluationOn: CredentialEvaluationDateSchema,
    personnelEvaluationOn: CredentialEvaluationDateSchema.optional(),
  })
  .strict();
export type BidConfigurationSettingsV2 = z.infer<typeof BidConfigurationSettingsV2Schema>;

/**
 * A live-capable annual configuration. Mock sessions remain compatible with
 * V2, but a real session must carry this fully explicit policy material.
 */
export const BidConfigurationSettingsV3Schema = z
  .object({
    v: z.literal(3),
    expectedDurationDays: z.number().int().min(1).max(7),
    turnTimerSeconds: z.number().int().min(30).max(600),
    credentialEvaluationOn: CredentialEvaluationDateSchema,
    personnelEvaluationOn: CredentialEvaluationDateSchema.optional(),
    livePolicy: FrozenLiveBidPolicySchema,
  })
  .strict();
export type BidConfigurationSettingsV3 = z.infer<typeof BidConfigurationSettingsV3Schema>;

export const BidConfigurationSettingsSchema = z.discriminatedUnion('v', [
  BidConfigurationSettingsV1Schema,
  BidConfigurationSettingsV2Schema,
  BidConfigurationSettingsV3Schema,
]);
export type BidConfigurationSettings = z.infer<typeof BidConfigurationSettingsSchema>;

/**
 * Immutable pointer to the exact accepted official staffing baseline used to
 * build a real session. It contains source provenance but no personnel data.
 */
export const FrozenStaffingBaselineSchema = z
  .object({
    baselineAcceptanceId: z.string().min(1),
    importId: z.string().min(1),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/i),
    acceptedAtMs: z.number().int().nonnegative(),
  })
  .strict();
export type FrozenStaffingBaseline = z.infer<typeof FrozenStaffingBaselineSchema>;

/**
 * Minimal identity material that an authorized operator needs to run a frozen
 * session. It is captured with the policy snapshot and must never be rebuilt
 * from the mutable employee directory during replay.
 */
export const FrozenOperatorIdentitySchema = z
  .object({
    memberId: z.number().int().positive(),
    employeeId: z.string().trim().min(1),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    rank: z.enum(['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF']),
  })
  .strict();
export type FrozenOperatorIdentity = z.infer<typeof FrozenOperatorIdentitySchema>;

/** Exact human-readable and executable policy relationship frozen for a session. */
export const FrozenAnnualPolicyEvidenceSchema = z
  .object({
    documentId: z.string().trim().min(1),
    documentRevision: z.number().int().positive(),
    ruleBookVersion: z.string().trim().min(1),
    executablePolicyRevision: z.string().trim().min(1),
    policyText: z.string().trim().min(1).max(100_000),
  })
  .strict();
export type FrozenAnnualPolicyEvidence = z.infer<typeof FrozenAnnualPolicyEvidenceSchema>;

/**
 * Immutable session input captured before ordinary Bid initialization. It is
 * deliberately limited to normalized identifiers and ordering data; no source
 * system material or person names are persisted in the snapshot.
 */
const BidSessionPolicySnapshotV1Schema = z
  .object({
    v: z.literal(1),
    ruleBookVersion: z.string().min(1),
    positionTemplateVersion: z.string().min(1),
    capturedAtMs: z.number().int().nonnegative(),
    members: z.array(FrozenBidPoolMemberSchema),
  })
  .strict();

const BidSessionPolicySnapshotV2Schema = z
  .object({
    v: z.literal(2),
    ruleBookVersion: z.string().min(1),
    ruleBookRevision: z.number().int().nonnegative(),
    positionTemplateVersion: z.string().min(1),
    configurationRevision: z.number().int().nonnegative(),
    settings: BidConfigurationSettingsSchema,
    capturedAtMs: z.number().int().nonnegative(),
    members: z.array(FrozenBidPoolMemberSchema),
  })
  .strict();

/**
 * V3 closes the mutable-draft gap in V2. It materializes the exact decoded
 * rule coverage and member eligibility inputs at creation; a later draft edit
 * therefore has no effect on an established mock (or live) session.
 */
const FrozenTenureEvidenceSchema = z
  .object({
    termMemberId: z.number().int().positive().nullable().optional(),
    accumulatedServiceMonths: z.number().int().nonnegative().nullable().optional(),
    consecutiveBidCycles: z.number().int().nonnegative().nullable().optional(),
    id: z.string().min(1),
    staffingPositionId: z.string().min(1),
    revision: z.number().int().positive(),
    effectiveOn: z.string(),
    status: z.enum(['PROTECTED', 'UNPROTECTED', 'UNKNOWN']),
    memberId: z.number().int().positive().nullable(),
    protectedFrom: z.string().nullable(),
    protectedThrough: z.string().nullable(),
    sourceRef: z.string().min(4),
    reason: z.string(),
    actorSubject: z.string(),
  })
  .strict();

const BidSessionPolicySnapshotV3Schema = z
  .object({
    v: z.literal(3),
    ruleBookVersion: z.string().min(1),
    ruleBookRevision: z.number().int().nonnegative(),
    positionTemplateVersion: z.string().min(1),
    configurationRevision: z.number().int().nonnegative(),
    settings: BidConfigurationSettingsSchema,
    /**
     * Present only for V2 settings. Existing V3 recovery snapshots with V1
     * settings remain readable; fresh snapshots must retain the same value as
     * their immutable V2 configuration.
     */
    credentialEvaluationOn: CredentialEvaluationDateSchema.optional(),
    /** Required for every newly-created live session; optional solely so
     * pre-remediation historical snapshots remain forensic-readable. */
    staffingBaseline: FrozenStaffingBaselineSchema.optional(),
    capturedAtMs: z.number().int().nonnegative(),
    members: z.array(FrozenBidEligibilityMemberSchema),
    tenureEvidence: z.array(FrozenTenureEvidenceSchema).optional(),
    /** Catalog identity is distinct from who holds a qualification. Old snapshots
     * retain their original reference validation when this evidence is absent. */
    authoringCredentialNames: z.array(z.string().trim().min(1).max(160)).optional(),
    /** Fresh snapshots materialize this; optional only for historical recovery. */
    operatorIdentityProjection: z.array(FrozenOperatorIdentitySchema).optional(),
    /** Optional only for pre-0044 recovery snapshots. Fresh annual V3 sessions materialize it. */
    annualPolicyEvidence: FrozenAnnualPolicyEvidenceSchema.optional(),
    ruleBookMaterial: FrozenRuleBookMaterialSchema,
  })
  .strict();

/** The same typed calculation inputs as a fresh V3 session, without a session,
 * saved revision, or source-document identity. Rule/template identifiers can
 * be internal pure-material identities; adapters must never present those as
 * persisted provenance. No defaults or execution permissions are added. */
const BidEvaluationBaseSchema = BidSessionPolicySnapshotV3Schema.omit({
  v: true,
  ruleBookRevision: true,
  configurationRevision: true,
  annualPolicyEvidence: true,
});
function refineBidPool(
  snapshot: { members: z.infer<typeof FrozenBidPoolMemberSchema>[] },
  ctx: z.RefinementCtx,
) {
  const seen = new Set<number>();
  for (const [index, member] of snapshot.members.entries()) {
    if (seen.has(member.memberId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['members', index, 'memberId'],
        message: 'memberId must occur once in a session policy snapshot',
      });
    }
    seen.add(member.memberId);
    if (member.pool === 'EXCLUDED' && member.exclusionReason === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['members', index, 'exclusionReason'],
        message: 'an excluded member must carry a deterministic exclusion reason',
      });
    }
    if (member.pool !== 'EXCLUDED' && member.exclusionReason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['members', index, 'exclusionReason'],
        message: 'a Bid-pool member cannot carry an exclusion reason',
      });
    }
    if (
      member.exclusionReason === 'ADMIN_ASSIGNED_NON_BIDDABLE' &&
      member.authoritativeAssignmentId === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['members', index, 'authoritativeAssignmentId'],
        message: 'an administrative-assignment exclusion must identify its frozen assignment',
      });
    }
  }
}
function refineBidEvaluation(
  snapshot: z.infer<typeof BidEvaluationBaseSchema>,
  ctx: z.RefinementCtx,
) {
  if (snapshot.settings.v === 2 || snapshot.settings.v === 3) {
    if (snapshot.credentialEvaluationOn === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credentialEvaluationOn'],
        message: 'V2 configuration settings require a frozen credential evaluation date',
      });
    } else if (snapshot.credentialEvaluationOn !== snapshot.settings.credentialEvaluationOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credentialEvaluationOn'],
        message: 'credential evaluation date must match the frozen configuration settings',
      });
    }
  } else if (snapshot.credentialEvaluationOn !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['credentialEvaluationOn'],
      message: 'legacy V1 configuration settings cannot claim a credential evaluation date',
    });
  }

  const credentialKeys = new Set<string>();
  for (const [memberIndex, member] of snapshot.members.entries()) {
    if (
      member.scoringEvidence &&
      (member.scoringEvidence.evaluationOn !== snapshot.credentialEvaluationOn ||
        new Set(member.scoringEvidence.completedCredentialNames).size !==
          member.scoringEvidence.completedCredentialNames.length)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['members', memberIndex, 'scoringEvidence'],
        message:
          'Completion evidence must match the approved qualification evaluation date and contain unique names',
      });
    for (const [credentialIndex, credentialName] of member.credentialNames.entries()) {
      const normalized = credentialName.trim().toLocaleLowerCase();
      const key = `${member.memberId}:${normalized}`;
      if (credentialKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', memberIndex, 'credentialNames', credentialIndex],
          message: 'credentialNames must be unique per session member',
        });
      }
      credentialKeys.add(key);
    }

    if (member.specialtyQualifications === undefined) continue;
    const specialtyCodes = new Set<string>();
    let priorSpecialtyCode: string | null = null;
    for (const [specialtyIndex, specialty] of member.specialtyQualifications.entries()) {
      const normalizedCode = specialty.specialtyCode.trim().toLocaleLowerCase();
      if (specialtyCodes.has(normalizedCode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            'members',
            memberIndex,
            'specialtyQualifications',
            specialtyIndex,
            'specialtyCode',
          ],
          message: 'specialtyQualifications must be unique per session member',
        });
      }
      specialtyCodes.add(normalizedCode);
      if (
        priorSpecialtyCode !== null &&
        priorSpecialtyCode.localeCompare(specialty.specialtyCode) >= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            'members',
            memberIndex,
            'specialtyQualifications',
            specialtyIndex,
            'specialtyCode',
          ],
          message: 'specialtyQualifications must be sorted by specialty code',
        });
      }
      priorSpecialtyCode = specialty.specialtyCode;

      const credentialEvaluationOn =
        snapshot.settings.v === 2 || snapshot.settings.v === 3
          ? snapshot.credentialEvaluationOn
          : undefined;
      if (credentialEvaluationOn === undefined) continue;
      if (specialty.effectiveOn > credentialEvaluationOn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', memberIndex, 'specialtyQualifications', specialtyIndex, 'effectiveOn'],
          message: 'frozen specialty evidence cannot begin after the evaluation date',
        });
      }
      if (
        specialty.status === 'active' &&
        specialty.expiresOn !== null &&
        specialty.expiresOn < credentialEvaluationOn
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', memberIndex, 'specialtyQualifications', specialtyIndex, 'expiresOn'],
          message: 'an active specialty qualification cannot be expired at the evaluation date',
        });
      }
      if (
        specialty.status === 'expired' &&
        specialty.expiresOn !== null &&
        specialty.expiresOn > credentialEvaluationOn
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', memberIndex, 'specialtyQualifications', specialtyIndex, 'expiresOn'],
          message: 'an expired specialty qualification must be expired at the evaluation date',
        });
      }
    }
  }

  const positionKeys = new Set<string>();
  for (const [index, position] of snapshot.ruleBookMaterial.positions.entries()) {
    const key = `${position.templateVersion}:${position.id}`;
    if (positionKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ruleBookMaterial', 'positions', index, 'id'],
        message: 'ruleBookMaterial positions must be unique per template',
      });
    }
    positionKeys.add(key);
    if (position.templateVersion !== snapshot.positionTemplateVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ruleBookMaterial', 'positions', index, 'templateVersion'],
        message: 'ruleBookMaterial position template must match the session snapshot',
      });
    }
  }

  const rulePositionKeys = new Set<string>();
  for (const [index, rule] of snapshot.ruleBookMaterial.rules.entries()) {
    const key = `${rule.templateVersion}:${rule.positionId}`;
    if (rulePositionKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ruleBookMaterial', 'rules', index, 'positionId'],
        message: 'ruleBookMaterial rules must be unique per template position',
      });
    }
    rulePositionKeys.add(key);
    if (rule.ruleBookVersion !== snapshot.ruleBookVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ruleBookMaterial', 'rules', index, 'ruleBookVersion'],
        message: 'ruleBookMaterial rule book must match the session snapshot',
      });
    }
    if (rule.templateVersion !== snapshot.positionTemplateVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ruleBookMaterial', 'rules', index, 'templateVersion'],
        message: 'ruleBookMaterial rule template must match the session snapshot',
      });
    }
  }
}
export const BidEvaluationSchema = BidEvaluationBaseSchema.superRefine((evaluation, ctx) => {
  refineBidPool(evaluation, ctx);
  refineBidEvaluation(evaluation, ctx);
});
export type BidEvaluation = z.infer<typeof BidEvaluationSchema>;

export const BidSessionPolicySnapshotSchema = z
  .discriminatedUnion('v', [
    BidSessionPolicySnapshotV1Schema,
    BidSessionPolicySnapshotV2Schema,
    BidSessionPolicySnapshotV3Schema,
  ])
  .superRefine((snapshot, ctx) => {
    if (
      snapshot.v === 3 &&
      snapshot.annualPolicyEvidence !== undefined &&
      snapshot.annualPolicyEvidence.ruleBookVersion !== snapshot.ruleBookVersion
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['annualPolicyEvidence', 'ruleBookVersion'],
        message: 'annual policy evidence rule book must match the session snapshot',
      });
    }
    if (
      snapshot.v === 3 &&
      snapshot.settings.v === 3 &&
      snapshot.annualPolicyEvidence !== undefined &&
      snapshot.annualPolicyEvidence.executablePolicyRevision !==
        snapshot.settings.livePolicy.policyRevision
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['annualPolicyEvidence', 'executablePolicyRevision'],
        message: 'annual policy evidence must name the frozen executable policy revision',
      });
    }
    refineBidPool(snapshot, ctx);
    if (snapshot.v === 3) refineBidEvaluation(snapshot, ctx);
  });
export type BidSessionPolicySnapshot = z.infer<typeof BidSessionPolicySnapshotSchema>;

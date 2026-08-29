import { z } from 'zod';

/**
 * A deliberately non-operational policy envelope used to exercise the generic
 * specialty engine in staging. It is persisted only with the synthetic mock
 * scenario and is never a substitute for approved MBFD specialty policy.
 */
export const SPECIALTY_TEST_POLICY_LABEL = 'TEST POLICY — NOT APPROVED MBFD POLICY' as const;

export const SPECIALTY_TEST_OUTCOME_VALUES = [
  'award',
  'declined',
  'unreachable',
  'withdrawn',
  'ineligible_on_recheck',
] as const;

export type SpecialtyTestOutcome = (typeof SPECIALTY_TEST_OUTCOME_VALUES)[number];

const OpaqueIdSchema = z.string().trim().min(1).max(160);
const PositiveIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const NonNegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const TieBreakSchema = z.enum(['rsc_seniority', 'rank_seniority', 'member_id']);
const CandidateOutcomeSchema = z.enum(SPECIALTY_TEST_OUTCOME_VALUES);
const FrozenSpecialtyQualificationSchema = z
  .object({
    specialtyCode: OpaqueIdSchema,
    status: z.enum(['active', 'expired', 'revoked', 'removed']),
    effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .strict();

const LegacyQualificationRequirementsSchema = z
  .array(OpaqueIdSchema)
  .min(1)
  .max(30)
  .superRefine((requirements, context) => {
    if (new Set(requirements).size !== requirements.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'qualification requirements must be unique',
      });
    }
  });

/**
 * Source-discriminated requirements for a new synthetic specialty scenario.
 * Credentials and specialty lifecycle codes have deliberately separate
 * namespaces, so a free-form value can never be silently reinterpreted as the
 * other source of qualification evidence.
 */
export const SpecialtyTestQualificationRequirementsV1Schema = z
  .object({
    v: z.literal(1),
    credential_names: z.array(OpaqueIdSchema).max(30),
    specialty_codes: z.array(OpaqueIdSchema).max(30),
  })
  .strict()
  .superRefine((requirements, context) => {
    const total = requirements.credential_names.length + requirements.specialty_codes.length;
    if (total === 0 || total > 30) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provide between one and thirty synthetic qualification requirements',
      });
    }
    for (const [field, values] of [
      ['credential_names', requirements.credential_names],
      ['specialty_codes', requirements.specialty_codes],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} entries must be unique`,
        });
      }
    }
  });

export const SpecialtyTestQualificationRequirementsSchema = z.union([
  LegacyQualificationRequirementsSchema,
  SpecialtyTestQualificationRequirementsV1Schema,
]);

export type SpecialtyTestQualificationRequirements = z.infer<
  typeof SpecialtyTestQualificationRequirementsSchema
>;
export type SpecialtyTestQualificationRequirementsV1 = z.infer<
  typeof SpecialtyTestQualificationRequirementsV1Schema
>;

export function isVersionedSpecialtyTestQualificationRequirements(
  requirements: SpecialtyTestQualificationRequirements,
): requirements is SpecialtyTestQualificationRequirementsV1 {
  return !Array.isArray(requirements);
}

const SpecialtyTestEligibilitySchema = z.union([
  z.object({ status: z.literal('eligible') }).strict(),
  z
    .object({
      status: z.literal('ineligible'),
      reasonCodes: z.array(OpaqueIdSchema).min(1).max(30),
    })
    .strict()
    .superRefine((eligibility, context) => {
      if (new Set(eligibility.reasonCodes).size !== eligibility.reasonCodes.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reasonCodes'],
          message: 'eligibility reason codes must be unique',
        });
      }
    }),
]);

export type SpecialtyTestEligibility = z.infer<typeof SpecialtyTestEligibilitySchema>;

/**
 * Explicit, immutable input facts from the synthetic session's frozen
 * snapshot. This intentionally contains no live roster or policy reference.
 */
export const SpecialtyTestFrozenCandidateFactsSchema = z
  .object({
    memberId: PositiveIntegerSchema,
    /** Lower explicit priority score wins before all configured tie-breaks. */
    explicitPriority: NonNegativeIntegerSchema,
    /** Lower numeric value is more senior, matching the existing Bid ordering. */
    rscSeniority: NonNegativeIntegerSchema,
    /** Lower numeric value is more senior, matching the existing Bid ordering. */
    rankSeniority: NonNegativeIntegerSchema,
    /** Frozen conventional credential names at the configured evaluation date. */
    credentialNames: z.array(OpaqueIdSchema).max(100),
    /**
     * Frozen specialty lifecycle facts at the configured evaluation date. The
     * list is required here: a legacy snapshot with no bridge data must fail
     * closed instead of being mistaken for an empty qualified set.
     */
    specialtyQualifications: z.array(FrozenSpecialtyQualificationSchema).max(100),
    generalEligibility: SpecialtyTestEligibilitySchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (new Set(candidate.credentialNames).size !== candidate.credentialNames.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credentialNames'],
        message: 'candidate credential names must be unique',
      });
    }
    if (
      new Set(candidate.specialtyQualifications.map((qualification) => qualification.specialtyCode))
        .size !== candidate.specialtyQualifications.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specialtyQualifications'],
        message: 'candidate specialty codes must be unique',
      });
    }
  });

export type SpecialtyTestFrozenCandidateFacts = z.infer<
  typeof SpecialtyTestFrozenCandidateFactsSchema
>;

export const SpecialtyTestPolicySchema = z
  .object({
    policy_label: z.literal(SPECIALTY_TEST_POLICY_LABEL),
    policy_version: OpaqueIdSchema,
    specialty_pool: z
      .object({
        id: OpaqueIdSchema,
        label: z.string().trim().min(1).max(200),
      })
      .strict(),
    qualification_requirements: SpecialtyTestQualificationRequirementsSchema,
    ranking: z
      .object({
        source: z.literal('EXPLICIT_TEST_PRIORITY'),
        reference: OpaqueIdSchema,
      })
      .strict(),
    /** Deliberate, versioned synthetic scoring declaration; never MBFD policy. */
    scoring: z
      .object({
        source: z.literal('EXPLICIT_TEST_PRIORITY'),
        direction: z.literal('LOWER_SCORE_WINS'),
      })
      .strict(),
    tie_break_chain: z.array(TieBreakSchema).min(1).max(3),
    normal_bid_interruption: z.literal('SUSPEND_EXACT_NORMAL_TURN'),
    candidate_outcomes: z
      .array(CandidateOutcomeSchema)
      .min(2)
      .max(SPECIALTY_TEST_OUTCOME_VALUES.length),
    original_bidder_resume: z.literal('RESUME_EXACT_ORIGINAL_TURN'),
  })
  .strict()
  .superRefine((policy, context) => {
    if (new Set(policy.tie_break_chain).size !== policy.tie_break_chain.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tie_break_chain'],
        message: 'tie-break chain entries must be unique',
      });
    }
    if (policy.tie_break_chain.at(-1) !== 'member_id') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tie_break_chain'],
        message: 'tie-break chain must end with member_id to make priority unambiguous',
      });
    }
    const outcomes = new Set(policy.candidate_outcomes);
    if (!outcomes.has('award')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidate_outcomes'],
        message: 'candidate outcomes must include award',
      });
    }
    if (!policy.candidate_outcomes.some((outcome) => outcome !== 'award')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidate_outcomes'],
        message: 'candidate outcomes must include at least one release reason',
      });
    }
    if (outcomes.size !== policy.candidate_outcomes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidate_outcomes'],
        message: 'candidate outcomes must be unique',
      });
    }
  });

export type SpecialtyTestPolicy = z.infer<typeof SpecialtyTestPolicySchema>;

export const SpecialtyTestPolicyEvaluationInputSchema = z
  .object({
    source: z.literal('synthetic'),
    policy: SpecialtyTestPolicySchema,
    frozenCandidates: z.array(SpecialtyTestFrozenCandidateFactsSchema).min(1).max(500),
  })
  .strict();

export type SpecialtyTestPolicyEvaluationInput = z.infer<
  typeof SpecialtyTestPolicyEvaluationInputSchema
>;

/** The engine-ready candidate record, derived exclusively from frozen synthetic facts. */
export interface EvaluatedSpecialtyTestPolicyCandidate {
  readonly memberId: number;
  /** Unique and sequential, with lower values resolved first by the engine. */
  readonly priorityRank: number;
  readonly generalEligibility: SpecialtyTestEligibility;
  readonly specialtyEligibility: SpecialtyTestEligibility;
}

export type SpecialtyTestPolicyEvaluationRejectCode =
  | 'INVALID_SYNTHETIC_EVALUATION_INPUT'
  | 'INVALID_SYNTHETIC_TEST_POLICY'
  | 'INVALID_FROZEN_CANDIDATE_FACTS'
  | 'LEGACY_SYNTHETIC_QUALIFICATION_MODEL_UNSUPPORTED'
  | 'DUPLICATE_MEMBER_ID'
  | 'AMBIGUOUS_SYNTHETIC_PRIORITY';

export type SpecialtyTestPolicyEvaluationResult =
  | {
      readonly kind: 'evaluated';
      readonly policyVersion: string;
      readonly allowedOutcomes: readonly SpecialtyTestOutcome[];
      readonly candidates: readonly EvaluatedSpecialtyTestPolicyCandidate[];
    }
  | {
      readonly kind: 'rejected';
      readonly code: SpecialtyTestPolicyEvaluationRejectCode;
    };

/**
 * Produces deterministic, engine-ready synthetic candidates from a frozen
 * snapshot. The policy label and literal input source make this evaluator
 * incapable of accepting an official MBFD policy envelope.
 */
export function evaluateSpecialtyTestPolicy(
  input: SpecialtyTestPolicyEvaluationInput,
): SpecialtyTestPolicyEvaluationResult {
  const parsedInput = SpecialtyTestPolicyEvaluationInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const possiblePolicy = isRecord(input) ? input.policy : undefined;
    if (!SpecialtyTestPolicySchema.safeParse(possiblePolicy).success) {
      return { kind: 'rejected', code: 'INVALID_SYNTHETIC_TEST_POLICY' };
    }
    const possibleFacts = isRecord(input) ? input.frozenCandidates : undefined;
    if (
      !z.array(SpecialtyTestFrozenCandidateFactsSchema).min(1).max(500).safeParse(possibleFacts)
        .success
    ) {
      return { kind: 'rejected', code: 'INVALID_FROZEN_CANDIDATE_FACTS' };
    }
    return { kind: 'rejected', code: 'INVALID_SYNTHETIC_EVALUATION_INPUT' };
  }

  const { policy, frozenCandidates } = parsedInput.data;
  const qualificationRequirements = policy.qualification_requirements;
  if (!isVersionedSpecialtyTestQualificationRequirements(qualificationRequirements)) {
    // Retain old persisted rehearsal state for inspection/reconnect, but never
    // begin a new scenario from an untyped list that cannot distinguish a
    // conventional credential from specialty lifecycle evidence.
    return { kind: 'rejected', code: 'LEGACY_SYNTHETIC_QUALIFICATION_MODEL_UNSUPPORTED' };
  }
  const seenMemberIds = new Set<number>();
  for (const candidate of frozenCandidates) {
    if (seenMemberIds.has(candidate.memberId)) {
      return { kind: 'rejected', code: 'DUPLICATE_MEMBER_ID' };
    }
    seenMemberIds.add(candidate.memberId);
  }

  const orderedFacts = [...frozenCandidates].sort((left, right) =>
    compareFrozenCandidates(left, right, policy.tie_break_chain),
  );
  if (
    orderedFacts.some((candidate, index) => {
      const previous = orderedFacts[index - 1];
      return (
        previous !== undefined &&
        compareFrozenCandidates(previous, candidate, policy.tie_break_chain) === 0
      );
    })
  ) {
    return { kind: 'rejected', code: 'AMBIGUOUS_SYNTHETIC_PRIORITY' };
  }

  return {
    kind: 'evaluated',
    policyVersion: policy.policy_version,
    allowedOutcomes: [...policy.candidate_outcomes],
    candidates: orderedFacts.map((candidate, priorityRank) => ({
      memberId: candidate.memberId,
      priorityRank,
      generalEligibility: cloneEligibility(candidate.generalEligibility),
      specialtyEligibility: deriveSpecialtyEligibility(candidate, qualificationRequirements),
    })),
  };
}

/**
 * Maps the engine's outcome vocabulary to the explicitly configured synthetic
 * test-policy allowlist. Malformed policies fail closed.
 */
export function isSpecialtyTestOutcomeAllowed(
  policy: SpecialtyTestPolicy,
  outcome: SpecialtyTestOutcome,
): boolean {
  const parsedPolicy = SpecialtyTestPolicySchema.safeParse(policy);
  return parsedPolicy.success && parsedPolicy.data.candidate_outcomes.includes(outcome);
}

function compareFrozenCandidates(
  left: SpecialtyTestFrozenCandidateFacts,
  right: SpecialtyTestFrozenCandidateFacts,
  tieBreakChain: readonly z.infer<typeof TieBreakSchema>[],
): number {
  const explicitPriorityOrder = left.explicitPriority - right.explicitPriority;
  if (explicitPriorityOrder !== 0) return explicitPriorityOrder;

  for (const tieBreak of tieBreakChain) {
    const order =
      tieBreak === 'rsc_seniority'
        ? left.rscSeniority - right.rscSeniority
        : tieBreak === 'rank_seniority'
          ? left.rankSeniority - right.rankSeniority
          : left.memberId - right.memberId;
    if (order !== 0) return order;
  }
  return 0;
}

function deriveSpecialtyEligibility(
  candidate: SpecialtyTestFrozenCandidateFacts,
  requirements: SpecialtyTestQualificationRequirementsV1,
): SpecialtyTestEligibility {
  const credentialNames = new Set(candidate.credentialNames);
  const activeSpecialtyCodes = new Set(
    candidate.specialtyQualifications
      .filter((qualification) => qualification.status === 'active')
      .map((qualification) => qualification.specialtyCode),
  );
  const missingCredentials = requirements.credential_names.filter(
    (requirement) => !credentialNames.has(requirement),
  );
  const inactiveSpecialtyCodes = requirements.specialty_codes.filter(
    (specialtyCode) => !activeSpecialtyCodes.has(specialtyCode),
  );
  if (missingCredentials.length === 0 && inactiveSpecialtyCodes.length === 0) {
    return { status: 'eligible' };
  }
  return {
    status: 'ineligible',
    reasonCodes: [
      ...missingCredentials.map(
        (requirement) => `SYNTHETIC_SPECIALTY_CREDENTIAL_MISSING:${requirement}`,
      ),
      ...inactiveSpecialtyCodes.map(
        (specialtyCode) => `SYNTHETIC_SPECIALTY_CODE_NOT_ACTIVE:${specialtyCode}`,
      ),
    ],
  };
}

function cloneEligibility(eligibility: SpecialtyTestEligibility): SpecialtyTestEligibility {
  return eligibility.status === 'eligible'
    ? { status: 'eligible' }
    : { status: 'ineligible', reasonCodes: [...eligibility.reasonCodes] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

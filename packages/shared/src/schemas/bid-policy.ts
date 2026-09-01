import { z } from 'zod';

/**
 * Controls whether a canonical staffing slot participates in ordinary Bid
 * selection. A staffing record may remain active while being outside Bid.
 */
export const BidParticipationSchema = z.enum(['BIDDABLE', 'ADMIN_ASSIGNED_NON_BIDDABLE']);
export type BidParticipation = z.infer<typeof BidParticipationSchema>;

/** Canonical calendar-date encoding used by frozen annual-policy facts. */
const FrozenPolicyCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'must be an ISO calendar date');

export const FrozenBidPoolMemberSchema = z
  .object({
    memberId: z.number().int().positive(),
    pool: z.enum(['OFC', 'FF', 'EXCLUDED']),
    rscSeniority: z.number().int().nonnegative(),
    rankSeniority: z.number().int().nonnegative().nullable(),
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
  rank: z.enum(['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF']),
  isProbationary: z.boolean(),
  credentialNames: z.array(z.string().trim().min(1)),
  /**
   * Optional only for pre-bridge V3 recovery snapshots. Fresh snapshots
   * always materialize the collection, including an empty collection; a
   * consumer must not treat an absent collection as evidence of eligibility.
   */
  specialtyQualifications: z.array(FrozenSpecialtyQualificationSchema).optional(),
}).strict();
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
  })
  .strict();
export type BidConfigurationSettingsV2 = z.infer<typeof BidConfigurationSettingsV2Schema>;

export const BidConfigurationSettingsSchema = z.discriminatedUnion('v', [
  BidConfigurationSettingsV1Schema,
  BidConfigurationSettingsV2Schema,
]);
export type BidConfigurationSettings = z.infer<typeof BidConfigurationSettingsSchema>;

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
    capturedAtMs: z.number().int().nonnegative(),
    members: z.array(FrozenBidEligibilityMemberSchema),
    ruleBookMaterial: FrozenRuleBookMaterialSchema,
  })
  .strict();

export const BidSessionPolicySnapshotSchema = z
  .discriminatedUnion('v', [
    BidSessionPolicySnapshotV1Schema,
    BidSessionPolicySnapshotV2Schema,
    BidSessionPolicySnapshotV3Schema,
  ])
  .superRefine((snapshot, ctx) => {
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

    if (snapshot.v !== 3) return;

    if (snapshot.settings.v === 2) {
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
          snapshot.settings.v === 2 ? snapshot.credentialEvaluationOn : undefined;
        if (credentialEvaluationOn === undefined) continue;
        if (specialty.effectiveOn > credentialEvaluationOn) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              'members',
              memberIndex,
              'specialtyQualifications',
              specialtyIndex,
              'effectiveOn',
            ],
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
  });
export type BidSessionPolicySnapshot = z.infer<typeof BidSessionPolicySnapshotSchema>;

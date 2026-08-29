import { z } from 'zod';

/**
 * Controls whether a canonical staffing slot participates in ordinary Bid
 * selection. A staffing record may remain active while being outside Bid.
 */
export const BidParticipationSchema = z.enum(['BIDDABLE', 'ADMIN_ASSIGNED_NON_BIDDABLE']);
export type BidParticipation = z.infer<typeof BidParticipationSchema>;

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
  })
  .strict();
export type FrozenBidPoolMember = z.infer<typeof FrozenBidPoolMemberSchema>;

/**
 * The deterministic eligibility inputs for a session member. These are kept
 * separate from employee identity so a session snapshot can reproduce policy
 * decisions without persisting names or source-system identifiers.
 */
export const FrozenBidEligibilityMemberSchema = FrozenBidPoolMemberSchema.extend({
  rank: z.enum(['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF']),
  isProbationary: z.boolean(),
  credentialNames: z.array(z.string().trim().min(1)),
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
export const BidConfigurationSettingsSchema = z
  .object({
    v: z.literal(1),
    expectedDurationDays: z.number().int().min(1).max(7),
    turnTimerSeconds: z.number().int().min(30).max(600),
  })
  .strict();
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

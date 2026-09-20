import { z } from 'zod';

const CredentialToken = z.string().trim().min(1).max(160);
const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Valid calendar date required',
  );
const CompletionCredit = z
  .object({
    sourceRef: z.string().trim().min(4).max(1000),
    effectiveFrom: CalendarDate,
    effectiveThrough: CalendarDate,
    memberIds: z.array(z.number().int().positive()).min(1).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.effectiveThrough >= v.effectiveFrom, 'Exception end must follow start');
const ScoringItemSchema = z
  .object({
    credential: CredentialToken,
    alternatives: z.array(CredentialToken).max(50),
    requiresAll: z.array(CredentialToken).max(50),
    points: z.number().int().min(0).max(10000),
    completionCredit: CompletionCredit.optional(),
  })
  .strict();
const PreferenceCriterionSchema = z
  .object({
    credential: CredentialToken,
    alternatives: z.array(CredentialToken).max(50),
    requiresAll: z.array(CredentialToken).max(50),
  })
  .strict();
const ScoringGroupSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    cap: z.number().int().min(0).max(100000).nullable(),
    items: z.array(ScoringItemSchema).max(200),
    excludesAny: z.array(CredentialToken).min(1).max(50).optional(),
    preference: z
      .object({
        mode: z.literal('BINARY_CUMULATIVE'),
        sourceRef: z.string().trim().min(4).max(1000),
        criteria: z.array(PreferenceCriterionSchema).min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((group, ctx) => {
    if (group.preference && (group.items.length > 0 || group.cap !== null))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preference'],
        message:
          'Cumulative preferences count every criterion once and cannot include points or a cap',
      });
  });
const ChannelSchema = z
  .array(ScoringGroupSchema)
  .max(100)
  .superRefine((groups, ctx) => {
    const ids = new Set<string>();
    const awardedTokens = new Set<string>();
    for (const [index, group] of groups.entries()) {
      if (ids.has(group.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'id'],
          message: 'Scoring group IDs must be unique',
        });
      ids.add(group.id);
      const items = group.preference?.criteria ?? group.items;
      for (const [itemIndex, item] of items.entries()) {
        for (const token of [item.credential, ...item.alternatives]) {
          if (awardedTokens.has(token))
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: group.preference
                ? [index, 'preference', 'criteria', itemIndex]
                : [index, 'items', itemIndex],
              message: 'A credential cannot earn duplicate credit in one ranking channel',
            });
          awardedTokens.add(token);
        }
      }
    }
  });

/** Explicit version pins the new semantics; omitted material retains legacy readers. */
export const ConfiguredScoringSchema = z
  .object({
    v: z.literal(1),
    total: ChannelSchema,
    so: ChannelSchema,
    mo: ChannelSchema,
    orderedPreference: z
      .object({
        mode: z.literal('ORDERED_QUALIFICATIONS'),
        sourceRef: z.string().trim().min(4).max(1000),
        criteria: z.array(PreferenceCriterionSchema).min(1).max(20),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ConfiguredScoring = z.infer<typeof ConfiguredScoringSchema>;

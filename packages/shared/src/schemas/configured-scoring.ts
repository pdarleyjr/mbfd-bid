import { z } from 'zod';

const CredentialToken = z.string().trim().min(1).max(160);
const ScoringItemSchema = z
  .object({
    credential: CredentialToken,
    alternatives: z.array(CredentialToken).max(50),
    requiresAll: z.array(CredentialToken).max(50),
    points: z.number().int().min(0).max(10000),
  })
  .strict();
const ScoringGroupSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    cap: z.number().int().min(0).max(100000).nullable(),
    items: z.array(ScoringItemSchema).max(200),
  })
  .strict();
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
      for (const [itemIndex, item] of group.items.entries()) {
        for (const token of [item.credential, ...item.alternatives]) {
          if (awardedTokens.has(token))
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, 'items', itemIndex],
              message: 'A credential cannot earn duplicate credit in one ranking channel',
            });
          awardedTokens.add(token);
        }
      }
    }
  });

/** Explicit version pins the new semantics; omitted material retains legacy readers. */
export const ConfiguredScoringSchema = z
  .object({ v: z.literal(1), total: ChannelSchema, so: ChannelSchema, mo: ChannelSchema })
  .strict();
export type ConfiguredScoring = z.infer<typeof ConfiguredScoringSchema>;

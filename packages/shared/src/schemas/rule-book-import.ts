import { z } from 'zod';

export const RuleBookEntrySchema = z.object({
  positionId: z.string().min(1),
  templateVersion: z.string().min(1),
  ruleBookVersion: z.string().min(1),
  requiredCriteria: z
    .object({
      credentials: z.array(z.string()).default([]),
      rank: z.array(z.enum(['FF', 'LT', 'CPT', 'DC'])).default([]),
      custom: z.array(z.string()).default([]),
    })
    .passthrough(),
  pointsPreference: z
    .object({
      max: z.number().nonnegative(),
      items: z.array(
        z.object({
          points: z.number(),
          credential: z.string(),
          gating: z.string().optional(),
        }),
      ),
    })
    .passthrough(),
  tieBreakChain: z.array(z.string()).default(['points', 'rsc_seniority', 'rank_seniority']),
  notes: z.string().optional().nullable(),
});

export type RuleBookEntry = z.infer<typeof RuleBookEntrySchema>;

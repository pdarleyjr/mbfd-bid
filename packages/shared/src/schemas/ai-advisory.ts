// AdvisorySchema — Zod gate for AI advisory JSON output.
// This file mirrors apps/worker/src/ai/output-schema.ts byte-for-byte
// (modulo comment headers). Drift is caught by a vitest in this package.
import { z } from 'zod';

export const WarningSchema = z.object({
  level: z.enum(['info', 'warn', 'critical']),
  text: z.string().min(1),
  affected_positions: z.array(z.string()).default([]),
});
export type Warning = z.infer<typeof WarningSchema>;

export const EligibleRecSchema = z.object({
  position_id: z.string().min(1),
  points: z.number().int().nonnegative(),
  why: z.string().min(1),
});
export type EligibleRec = z.infer<typeof EligibleRecSchema>;

export const IneligibleTopPickSchema = z.object({
  position_id: z.string().min(1),
  why_ineligible: z.string().min(1),
});
export type IneligibleTopPick = z.infer<typeof IneligibleTopPickSchema>;

export const AdvisorySchema = z
  .object({
    summary: z.string().min(1),
    eligible_recommendations: z.array(EligibleRecSchema),
    ineligible_top_picks: z.array(IneligibleTopPickSchema),
    forecast: z.object({ warnings: z.array(WarningSchema).default([]) }).default({ warnings: [] }),
    force_recommended: z.boolean(),
    force_reasoning: z.string().optional(),
    // Set in Plan 07 (A-Day phase 2) — invariants captured at advisory time so
    // post-hoc audits can replay the bid against the same board state.
    aDayInvariantSnapshot: z.record(z.unknown()).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.force_recommended && !val.force_reasoning) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'force_reasoning required when force_recommended=true',
        path: ['force_reasoning'],
      });
    }
  });
export type Advisory = z.infer<typeof AdvisorySchema>;

/** Marker fields added at the API boundary; not produced by the model. */
export const AdvisoryEnvelopeSchema = z.object({
  advisory: AdvisorySchema,
  stale: z.boolean().default(false),
  fallback: z.enum(['none', 'deterministic', 'last_good']).default('none'),
  generated_at_ms: z.number().int().nonnegative(),
  ai_advisory_id: z.string().nullable(),
});
export type AdvisoryEnvelope = z.infer<typeof AdvisoryEnvelopeSchema>;

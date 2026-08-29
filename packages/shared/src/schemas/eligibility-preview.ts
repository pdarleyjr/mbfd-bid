import { z } from 'zod';

export const EligibilityPreviewSchema = z.object({
  member_id: z.number().int().positive(),
  position_id: z.string().regex(/^[A-D]\d{3}$/),
  rule_book_version: z
    .string()
    .regex(/^\d{4}\.\d+$/)
    .optional(),
  /** Optional calendar date makes the preview reproducible with frozen Bid evaluation. */
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type EligibilityPreview = z.infer<typeof EligibilityPreviewSchema>;

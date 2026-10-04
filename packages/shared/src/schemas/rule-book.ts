import { z } from 'zod';
import { BidOperationNoteSchema } from './bid-operation-note.js';

export const RuleBookStatusSchema = z.enum(['draft', 'active', 'archived']);
export type RuleBookStatus = z.infer<typeof RuleBookStatusSchema>;

export const PublishRuleBookSchema = z.object({
  reason: BidOperationNoteSchema,
});
export type PublishRuleBook = z.infer<typeof PublishRuleBookSchema>;

export const CreateRuleBookSchema = z.object({
  effective_year: z.number().int().min(2024).max(2100),
  clone_from: z
    .string()
    .regex(/^\d{4}\.\d+$/)
    .optional(),
  notes: z.string().max(2000).optional(),
  reason: BidOperationNoteSchema,
});
export type CreateRuleBook = z.infer<typeof CreateRuleBookSchema>;

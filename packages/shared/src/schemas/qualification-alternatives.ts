import { z } from 'zod';
/** Every group is required; one exact credential token within each group suffices. */
export const QualificationAlternativesSchema = z
  .array(
    z
      .array(z.string().trim().min(1).max(160))
      .min(1)
      .max(50)
      .refine((v) => new Set(v).size === v.length, 'Alternative credentials must be unique'),
  )
  .max(50);

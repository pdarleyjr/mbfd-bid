import { z } from 'zod';

export const CredentialImportRowSchema = z
  .object({
    name: z.string().min(1).max(120),
    fy_points_default: z.union([z.string(), z.number()]).transform(Number).default(0),
    abbreviation: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .passthrough()
  .transform((row) => ({
    name: row.name.trim(),
    fyPointsDefault: row.fy_points_default,
    abbreviation: row.abbreviation?.trim() ?? null,
    notes: row.notes?.trim() ?? null,
  }));

export type CredentialImportRow = z.infer<typeof CredentialImportRowSchema>;

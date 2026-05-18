import { z } from 'zod';
import type { RANKS } from '../constants/ranks.js';

type Rank = (typeof RANKS)[number];

const RANK_FROM_LABEL: Record<string, Rank> = {
  Firefighter: 'FF',
  Lieutenant: 'LT',
  Captain: 'CPT',
  'Division Chief': 'DC',
  'Deputy Fire Chief': 'DEP_CHIEF',
  'Fire Chief': 'CHIEF',
};

// Aliases for the Telestaff raw export columns; the parser lowercases + strips
// whitespace from headers, so 'RscSeniorityIn' arrives as 'rscseniorityin'.
const COLUMN_ALIASES: Record<string, string> = {
  rscseniorityin: 'rsc_seniority',
  rschiredt: 'hired_at',
  rscpromotiondt: 'promoted_at',
};

export const MemberImportRowSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== 'object') return raw;
    const row = { ...(raw as Record<string, unknown>) };
    for (const [alias, canonical] of Object.entries(COLUMN_ALIASES)) {
      if (row[canonical] === undefined && row[alias] !== undefined) {
        row[canonical] = row[alias];
      }
    }
    return row;
  },
  z
    .object({
      employee_id: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
      last_name: z.string().min(1),
      first_name: z.string().min(1),
      current_rank: z.string().min(1),
      bid_rank: z.string().optional().nullable(),
      bid_category: z.string(),
      bid: z.enum(['Include', 'Exclude']),
      rsc_seniority: z.union([z.string(), z.number()]).transform(Number),
      hired_at: z.string().optional().nullable(),
      promoted_at: z.string().optional().nullable(),
    })
    .passthrough()
    .transform((row, ctx) => {
      const rank = RANK_FROM_LABEL[row.current_rank];
      if (!rank) {
        ctx.addIssue({ code: 'custom', message: `Unknown rank "${row.current_rank}"` });
        return z.NEVER;
      }
      const bidCategory: 'OFC' | 'FF' | 'EXCLUDED' =
        row.bid === 'Exclude' ? 'EXCLUDED' : row.bid_category === 'OFC' ? 'OFC' : 'FF';
      return {
        employeeId: row.employee_id,
        lastName: row.last_name.trim(),
        firstName: row.first_name.trim(),
        rank,
        bidCategory,
        rscSeniority: row.rsc_seniority,
        hiredAt: row.hired_at ?? null,
        promotedAt: row.promoted_at ?? null,
      };
    }),
);

export type MemberImportRow = z.infer<typeof MemberImportRowSchema>;

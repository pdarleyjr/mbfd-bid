import { z } from 'zod';
import type { RANKS } from '../constants/ranks.js';

const RANK_FROM_LABEL: Record<string, (typeof RANKS)[number]> = {
  Firefighter: 'FF',
  Lieutenant: 'LT',
  Captain: 'CPT',
  'Division Chief': 'DC',
  'Deputy Fire Chief': 'DEP_CHIEF',
  'Fire Chief': 'CHIEF',
};

export const MemberImportRowSchema = z
  .object({
    employee_id: z.string().min(1),
    last_name: z.string().min(1),
    first_name: z.string().min(1),
    current_rank: z.string().min(1),
    bid_rank: z.string().optional().nullable(),
    bid_category: z.string(), // can be "OFC", "FF", "0", ""
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
      employeeId: row.employee_id.trim(),
      lastName: row.last_name.trim(),
      firstName: row.first_name.trim(),
      rank,
      bidCategory,
      rscSeniority: row.rsc_seniority,
      hiredAt: row.hired_at ?? null,
      promotedAt: row.promoted_at ?? null,
    };
  });

export type MemberImportRow = z.infer<typeof MemberImportRowSchema>;

import { z } from 'zod';

/** Reviewed annual Bid ordinals are neither employment dates nor legacy RSC. */
export const BidOrdinalKeySchema = z.enum([
  'RSC_SENIORITY',
  'RANK_SENIORITY',
  'TIME_IN_GRADE_BID_ORDINAL',
  'DEPARTMENT_SERVICE_BID_ORDINAL',
]);
export const FrozenBidOrdinalEvidenceSchema = z
  .object({
    datasetId: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    timeInGrade: z.number().int().safe().positive(),
    departmentService: z.number().int().safe().positive(),
  })
  .strict();
export const BidOrdinalImportSchema = z
  .object({
    bidYear: z.number().int().min(2024).max(2100),
    expectedRevision: z
      .number()
      .int()
      .safe()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRef: z.string().trim().min(4).max(1000),
    reason: z.string().trim().min(4).max(1000),
    entries: z
      .array(
        z
          .object({
            memberId: z.number().int().safe().positive(),
            employeeId: z.string().trim().min(1).max(100),
            timeInGrade: z.number().int().safe().positive(),
            departmentService: z.number().int().safe().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const key of ['memberId', 'employeeId', 'timeInGrade', 'departmentService'] as const) {
      if (new Set(value.entries.map((entry) => entry[key])).size !== value.entries.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries'],
          message: `Duplicate ${key} requires source review`,
        });
    }
  });
export type FrozenBidOrdinalEvidence = z.infer<typeof FrozenBidOrdinalEvidenceSchema>;
function safeOrdinal(value: number | undefined): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function bidOrdinalValue(
  member: {
    rscSeniority: number;
    rankSeniority: number | null;
    bidOrdinalEvidence?: FrozenBidOrdinalEvidence | undefined;
  },
  key: z.infer<typeof BidOrdinalKeySchema>,
): number | null {
  switch (key) {
    case 'RSC_SENIORITY':
      return member.rscSeniority;
    case 'RANK_SENIORITY':
      return member.rankSeniority;
    case 'TIME_IN_GRADE_BID_ORDINAL':
      return safeOrdinal(member.bidOrdinalEvidence?.timeInGrade);
    case 'DEPARTMENT_SERVICE_BID_ORDINAL':
      return safeOrdinal(member.bidOrdinalEvidence?.departmentService);
  }
}

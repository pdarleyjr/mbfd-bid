import { z } from 'zod';
const ServiceCode = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z][A-Z0-9_]*$/);
export const ServiceRequirementsSchema = z
  .array(
    z
      .object({ serviceCode: ServiceCode, minimumMonths: z.number().int().min(1).max(1200) })
      .strict(),
  )
  .max(30)
  .refine(
    (rows) => new Set(rows.map((r) => r.serviceCode)).size === rows.length,
    'Service requirements must be unique',
  );
export const FrozenServiceCreditSchema = z
  .object({
    serviceCode: ServiceCode,
    verifiedMonths: z.number().int().min(0).max(1200).nullable(),
    effectiveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    recordId: z.string().min(1),
    sourceRef: z.string().min(4),
    actorSubject: z.string().min(1),
  })
  .strict();
export type FrozenServiceCredit = z.infer<typeof FrozenServiceCreditSchema>;

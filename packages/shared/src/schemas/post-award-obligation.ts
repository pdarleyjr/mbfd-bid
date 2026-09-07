import { z } from 'zod';
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'An explicit valid calendar date is required');
const deadlinePeriod = z.object({
  unit: z.enum(['CALENDAR_DAYS', 'CALENDAR_MONTHS']),
  count: z.number().int().min(1).max(1200),
  timeZone: z.enum(['America/New_York', 'UTC']),
});
export const PostAwardObligationSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    credential: z.string().trim().min(1).max(160),
    sourceRef: z.string().trim().min(4).max(500),
    deadline: z.discriminatedUnion('basis', [
      deadlinePeriod.extend({ basis: z.literal('FINAL_POSITION_AWARD') }).strict(),
      deadlinePeriod
        .extend({ basis: z.literal('APPROVED_BID_START_DATE'), startOn: calendarDate })
        .strict(),
    ]),
  })
  .strict();
export const PostAwardObligationsSchema = z
  .array(PostAwardObligationSchema)
  .max(50)
  .refine(
    (items) => new Set(items.map((i) => i.id)).size === items.length,
    'Obligation IDs must be unique',
  );
export type PostAwardObligation = z.infer<typeof PostAwardObligationSchema>;

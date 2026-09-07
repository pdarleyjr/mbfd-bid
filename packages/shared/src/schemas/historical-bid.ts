import { z } from 'zod';

const text = z.string().trim().min(1).max(500);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/** Documentary history only. These records never establish live member or position identity. */
export const HistoricalBidSchema = z
  .object({
    schemaVersion: z.literal(1),
    year: z.number().int().min(2000).max(9999),
    label: text,
    notes: z.array(text).max(30),
    sources: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,64}$/),
            name: text,
            sha256,
          })
          .strict(),
      )
      .min(1)
      .max(20),
    seats: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-D][0-9]{3}$/),
            shift: z.enum(['A', 'B', 'C', 'D']),
            station: text,
            unit: text,
            position: text.nullable(),
            name: text.nullable(),
            group: z.string().max(50).nullable(),
            status: z.enum(['AWARDED', 'WITHDRAWN', 'OFFICIAL_POSITION_SUPPLEMENT']),
            sourceId: text,
            sourceLocation: text,
            note: text.nullable(),
            employeeReference: z
              .object({
                employeeId: z.string().regex(/^[0-9]{1,20}$/),
                sourceId: text,
                sourceLocation: text,
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
  .superRefine((archive, ctx) => {
    const sources = new Set(archive.sources.map((source) => source.id));
    if (sources.size !== archive.sources.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate source ID' });
    const ids = new Set<string>();
    for (const [index, seat] of archive.seats.entries()) {
      const fail = (message: string) =>
        ctx.addIssue({ code: 'custom', path: ['seats', index], message });
      if (ids.has(seat.id)) fail('Duplicate historical position ID');
      ids.add(seat.id);
      if (!seat.id.startsWith(seat.shift)) fail('Position and shift disagree');
      if (!sources.has(seat.sourceId)) fail('Unknown documentary source');
      if (seat.employeeReference && !sources.has(seat.employeeReference.sourceId))
        fail('Unknown employee reference source');
      if (seat.status === 'AWARDED' && !seat.name) fail('Award requires a source name');
      if (seat.status === 'WITHDRAWN' && seat.name) fail('Withdrawn position cannot have an award');
      if (seat.status === 'OFFICIAL_POSITION_SUPPLEMENT' && (seat.shift !== 'D' || !seat.note))
        fail('D supplement requires an explicit source note');
    }
  });

export const HistoricalBidReceiptSchema = z
  .object({
    archive: HistoricalBidSchema,
    sha256,
    publishedAt: z.string().datetime(),
    publishedBy: z.string().min(1),
    revisionId: z.string().uuid().optional(),
    amendment: z
      .object({
        supersedesRevisionId: z.string().regex(/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/),
        supersedesSha256: sha256,
        reason: text,
      })
      .strict()
      .optional(),
  })
  .strict();
export type HistoricalBid = z.infer<typeof HistoricalBidSchema>;
export type HistoricalBidReceipt = z.infer<typeof HistoricalBidReceiptSchema>;

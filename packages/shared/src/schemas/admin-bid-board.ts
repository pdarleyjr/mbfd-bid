import { z } from 'zod';

export const AdminBoardViewSchema = z.enum(['previous', 'current', 'upcoming']);
const Seat = z.object({
  id: z.string(),
  shift: z.string().nullable(),
  station: z.string().nullable(),
  unit: z.string().nullable(),
  position: z.string().nullable(),
  rank: z.string().nullable(),
});
const Occupant = z
  .object({
    memberId: z.number(),
    name: z.string().nullable(),
    nameSource: z.enum(['current', 'frozen', 'unavailable']),
  })
  .strict();
const Source = z
  .object({
    label: z.string(),
    year: z.number().nullable(),
    asOf: z.string().nullable(),
    sessionId: z.string().nullable(),
    templateVersion: z.string().nullable(),
    ruleBookVersion: z.string().nullable(),
    configurationRevision: z.number().nullable(),
    ruleBookRevision: z.number().nullable(),
    completionRevision: z.number().nullable(),
  })
  .strict();
const Common = { source: Source, notice: z.string().nullable(), generatedAt: z.string() };
export const AdminBidBoardSchema = z.discriminatedUnion('view', [
  z
    .object({
      ...Common,
      view: z.literal('previous'),
      lifecycle: z.enum(['COMPLETE', 'UNAVAILABLE']),
      seats: z.array(
        Seat.extend({ award: Occupant.nullable(), aDay: z.string().nullable() }).strict(),
      ),
    })
    .strict(),
  z
    .object({
      ...Common,
      view: z.literal('current'),
      lifecycle: z.literal('CURRENT'),
      seats: z.array(
        Seat.extend({
          occupancy: z.enum(['occupied', 'vacant', 'unmapped']),
          occupant: Occupant.nullable(),
          assignmentOrigin: z.string().nullable(),
          temporaryContext: z.array(
            z
              .object({
                id: z.string(),
                kind: z.enum(['SPECIAL_ASSIGNMENT', 'LIGHT_DUTY']),
                effectiveOn: z.string(),
                plannedEndOn: z.string().nullable(),
                actualEndOn: z.string().nullable(),
              })
              .strict(),
          ),
        }).strict(),
      ),
    })
    .strict(),
  // There is deliberately no occupant field in the upcoming contract.
  z
    .object({
      ...Common,
      view: z.literal('upcoming'),
      lifecycle: z.enum(['DRAFT', 'FROZEN', 'UNAVAILABLE']),
      seats: z.array(
        Seat.extend({
          participation: z.enum([
            'BIDDABLE',
            'ADMIN_ASSIGNED_NON_BIDDABLE',
            'RESERVED_NON_BIDDABLE',
          ]),
          mapping: z.enum(['mapped', 'review_required']),
        }).strict(),
      ),
    })
    .strict(),
]);
export type AdminBidBoard = z.infer<typeof AdminBidBoardSchema>;

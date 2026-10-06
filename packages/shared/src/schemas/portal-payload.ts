// Plan 08 Task 18 — Portal write-back payload (spec §11.8.3).
//
// One source of truth for the JSON we POST to /bid-assignment on the
// MBFD employee portal. Imported by:
//   - the queue producer (DO step 4)
//   - the queue consumer (POSTs the JSON)
//   - the integration tests (round-trip parsing)
// Drift between producer and consumer is impossible by construction.

import { z } from 'zod';

export const ShiftLabelSchema = z.enum(['A Shift', 'B Shift', 'C Shift', 'D Shift']);
export type ShiftLabel = z.infer<typeof ShiftLabelSchema>;

export const RankLabelSchema = z.enum([
  'Firefighter',
  'Lieutenant',
  'Captain',
  'Division Chief',
  'Deputy Fire Chief',
  'Fire Chief',
]);
export type RankLabel = z.infer<typeof RankLabelSchema>;

export const PortalPayloadV1Schema = z.object({
  bid_year: z.number().int(),
  bid_session_id: z.string().min(1),
  rank_label: RankLabelSchema,
  station_label: z.string().min(1),
  shift_label: ShiftLabelSchema,
  unit_label: z.string().min(1),
  /** Either "Pending Phase 2", "Group 1..4", or a weekday name for D-shift. */
  a_day_label: z.string().min(1),
  position_id: z.string().min(1),
  /** RFC 3339 / ISO 8601 timestamp. */
  picked_at: z.string().min(1),
  /** Stable client-side key used by the portal for idempotency. */
  idempotency_key: z.string().min(1),
  is_forced: z.boolean(),
  admin_actor_employee_id: z.string().nullable(),
});
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const PortalPayloadV2Schema = z
  .object({
    payload_version: z.literal(2),
    bid_year: z.number().int().min(2024).max(2099),
    term_label: z.string().min(1),
    bid_session_id: z.string().min(1),
    employee_id: z.string().min(1),
    rank_label: RankLabelSchema,
    station_label: z.string().min(1),
    shift_label: ShiftLabelSchema,
    division_label: z.string().min(1),
    unit_label: z.string().min(1),
    position_id: z.string().min(1),
    position_label: z.string().min(1),
    bid_selection_label: z.string().min(1),
    assignment_type: z.enum(['Assigned', 'Floating']),
    assignment_source: z.enum(['bid_award', 'retained_nonbiddable']),
    a_day_code: z.enum(['G1', 'G2', 'G3', 'G4', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
    a_day_label: z.string().min(1),
    picked_at: z.string().datetime().nullable(),
    idempotency_key: z.string().min(1),
    is_forced: z.boolean(),
    admin_actor_employee_id: z.string().nullable(),
    source_sequence: z.number().int().nonnegative(),
    source_result_hash: Sha256Schema,
    source_workbook_sha256: Sha256Schema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.assignment_source === 'bid_award' && value.picked_at === null)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['picked_at'],
        message: 'Award timestamp required',
      });
    if (
      value.assignment_source === 'retained_nonbiddable' &&
      (value.picked_at !== null || value.is_forced || value.admin_actor_employee_id !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Retained assignment has no pick provenance',
      });
  });
export type PortalPayloadV2 = z.infer<typeof PortalPayloadV2Schema>;
// Reject unsupported versions rather than stripping their exact-result fields as V1.
export const PortalPayloadSchema = z.union([
  PortalPayloadV2Schema,
  PortalPayloadV1Schema.refine((value) => !('payload_version' in value)).and(
    z.object({ payload_version: z.never().optional() }).passthrough(),
  ),
]);
export type PortalPayload = z.infer<typeof PortalPayloadSchema>;

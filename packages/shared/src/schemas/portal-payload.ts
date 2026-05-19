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

export const PortalPayloadSchema = z.object({
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
export type PortalPayload = z.infer<typeof PortalPayloadSchema>;

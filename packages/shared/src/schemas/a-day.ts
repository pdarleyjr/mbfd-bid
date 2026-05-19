// packages/shared/src/schemas/a-day.ts
import { z } from 'zod';

export const ADayGroupIdSchema = z.enum(['G1', 'G2', 'G3', 'G4']);
export type ADayGroupId = z.infer<typeof ADayGroupIdSchema>;

export const WeekdaySchema = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const ADayValueSchema = z.union([ADayGroupIdSchema, WeekdaySchema]);
export type ADayValue = z.infer<typeof ADayValueSchema>;

export const ShiftSchema = z.enum(['A', 'B', 'C', 'D']);
export type Shift = z.infer<typeof ShiftSchema>;

/** Reason codes shared with @mbfd/a-day's PickValidation rejection branch. */
export const ADayRejectReasonCodeSchema = z.enum([
  'NOT_YOUR_TURN',
  'PHASE_NOT_A_DAY_BID',
  'NO_PHASE_1_PICK',
  'ALREADY_PICKED',
  'GROUP_FULL',
  'WEEKDAY_FULL',
  'OFFICER_INVARIANT_VIOLATED',
  'INVALID_A_DAY_FOR_SHIFT',
  'UNKNOWN_MEMBER',
]);
export type ADayRejectReasonCode = z.infer<typeof ADayRejectReasonCodeSchema>;

/** Capacity meter payload shared in WS messages. */
export const CapacityMeterPayloadSchema = z.object({
  total: z.number().int().nonnegative(),
  max: z.number().int().nonnegative().optional(),
  officers: z.number().int().nonnegative(),
  officersRequired: z.number().int().nonnegative().optional(),
  isFull: z.boolean(),
});

/** Snapshot of all capacity meters, used by board UI and AI advisory. */
export const MetersBundleSchema = z.object({
  groups: z.array(
    z.object({
      shift: z.enum(['A', 'B', 'C']),
      group: ADayGroupIdSchema,
      meter: CapacityMeterPayloadSchema,
    }),
  ),
  weekdays: z.array(
    z.object({
      weekday: WeekdaySchema,
      meter: CapacityMeterPayloadSchema,
    }),
  ),
});

/** CLIENT → SERVER: submit an A-Day pick (WS or REST body). */
export const SubmitADayPickRequestSchema = z.object({
  v: z.literal(1),
  bidSessionId: z.string().min(1),
  aDay: ADayValueSchema,
  idempotencyKey: z.string().uuid(),
});
export type SubmitADayPickRequest = z.infer<typeof SubmitADayPickRequestSchema>;

/** SERVER → CLIENT: pick made, broadcast to all. */
export const ADayPickMadeMessageSchema = z.object({
  type: z.literal('a_day_pick_made'),
  v: z.literal(1),
  seq: z.number().int().nonnegative(),
  memberId: z.number().int().positive(),
  shift: ShiftSchema,
  aDay: ADayValueSchema,
  pickedAtMs: z.number().int().nonnegative(),
  forced: z.boolean(),
  adminActorId: z.number().int().nullable(),
  /** Next member id whose turn starts, or null if Phase 2 is complete. */
  nextMemberId: z.number().int().positive().nullable(),
  meters: MetersBundleSchema,
});
export type ADayPickMadeMessage = z.infer<typeof ADayPickMadeMessageSchema>;

/** SERVER → CLIENT: phase transition. */
export const PhaseChangedMessageSchema = z.object({
  type: z.literal('phase_changed'),
  v: z.literal(1),
  from: z.enum(['config', 'position_bid', 'a_day_bid', 'paused']),
  to: z.enum(['position_bid', 'a_day_bid', 'paused', 'complete']),
  /** Populated only when to === 'a_day_bid'. */
  bidOrderPhase2: z.array(z.number().int().positive()).optional(),
});
export type PhaseChangedMessage = z.infer<typeof PhaseChangedMessageSchema>;

/** SERVER → CLIENT: pick rejected. Sent only to the submitter's connection. */
export const ADayRejectMessageSchema = z.object({
  type: z.literal('a_day_reject'),
  v: z.literal(1),
  memberId: z.number().int().positive(),
  reasonCode: ADayRejectReasonCodeSchema,
  reasonLabel: z.string(),
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type ADayRejectMessage = z.infer<typeof ADayRejectMessageSchema>;

/** Discriminated union of all Phase-2 server-to-client messages. */
export const ADayServerMessageSchema = z.discriminatedUnion('type', [
  ADayPickMadeMessageSchema,
  PhaseChangedMessageSchema,
  ADayRejectMessageSchema,
]);
export type ADayServerMessage = z.infer<typeof ADayServerMessageSchema>;

import { z } from 'zod';
import { ReasonCodeSchema } from './reason-codes.js';

/**
 * Common reason payload — every state-mutating admin write carries a free
 * text reason (4+ chars) AND a machine-stable reason_code. The action-
 * level schemas further constrain reason_code to a sub-enum.
 */
const reason = z.string().trim().min(4, 'Reason must be at least 4 characters').max(500);

/** Position ID — natural key like "A101", "D305". */
const positionId = z
  .string()
  .trim()
  .regex(/^[A-D]\d{3}$/, 'Position ID format: <shift><3-digits>');

const memberId = z.number().int().positive();

const aDay = z.enum(['G1', 'G2', 'G3', 'G4', 'Mon', 'Wed', 'Fri']);

/** Force-pick — eligibility BYPASSED. */
export const ForcePickSchema = z.object({
  member_id: memberId,
  position_id: positionId,
  reason_code: ReasonCodeSchema.refine(
    (c) => c === 'force.reverse_seniority' || c === 'force.cert_mandate',
    'reason_code must be a force.* code',
  ),
  reason,
});
export type ForcePick = z.infer<typeof ForcePickSchema>;

/** Skip — member loses turn without a recorded pick. */
export const SkipSchema = z.object({
  member_id: memberId,
  reason_code: ReasonCodeSchema.refine(
    (c) => c === 'skip.unreachable' || c === 'skip.declined',
    'reason_code must be a skip.* code',
  ),
  reason,
});
export type Skip = z.infer<typeof SkipSchema>;

/** Bid-for-member — proxy bid, eligibility IS enforced. */
export const BidForMemberSchema = z.object({
  member_id: memberId,
  position_id: positionId,
  a_day: aDay.optional(),
  reason_code: ReasonCodeSchema.refine(
    (c) => c === 'bid_for_member.unreachable_phone',
    'reason_code must be bid_for_member.unreachable_phone',
  ),
  reason,
});
export type BidForMember = z.infer<typeof BidForMemberSchema>;

/** Lock-position — pre-bid auto-placement. */
export const LockPositionSchema = z.object({
  member_id: memberId,
  position_id: positionId,
  reason_code: ReasonCodeSchema.refine((c) => c.startsWith('lock_position.'), {
    message: 'reason_code must be lock_position.*',
  }),
  reason,
});
export type LockPosition = z.infer<typeof LockPositionSchema>;

/** Pause — emergency or day-end. */
export const PauseSessionSchema = z.object({
  reason_code: ReasonCodeSchema.refine((c) => c.startsWith('session.'), {
    message: 'reason_code must be session.*',
  }),
  reason,
});
export type PauseSession = z.infer<typeof PauseSessionSchema>;

/** Resume — empty body. */
export const ResumeSessionSchema = z.object({}).strict();
export type ResumeSession = z.infer<typeof ResumeSessionSchema>;

/** Day-end — records scheduled UTC resume timestamp. */
export const DayEndSchema = z.object({
  scheduled_resume_at: z.string().datetime({ message: 'must be ISO 8601 UTC' }),
  reason,
});
export type DayEnd = z.infer<typeof DayEndSchema>;

/** Day-start — empty body; server uses now() as resume time. */
export const DayStartSchema = z.object({}).strict();
export type DayStart = z.infer<typeof DayStartSchema>;

/** Timer config PATCH — clamped to a sensible range. */
export const TimerConfigSchema = z.object({
  turn_timer_seconds: z.number().int().min(30).max(600),
});
export type TimerConfig = z.infer<typeof TimerConfigSchema>;

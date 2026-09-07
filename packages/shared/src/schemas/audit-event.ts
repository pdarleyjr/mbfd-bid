// Plan 08 Task 4 — AuditEvent Zod schema (shared between worker + verifier).
//
// The enum mirrors `audit_log.action` in the worker DB schema (migrations
// 0001 → 0012). New actions must be added here AND in the DB enum or a chain
// verification will fail when the verifier replays the JSONL.

import { z } from 'zod';

export const AuditActionSchema = z.enum([
  'pick',
  'forced_pick',
  'pause',
  'resume',
  'skip',
  'override_rule',
  'override_cert',
  'lock_position',
  'unlock_position',
  'grant_extension',
  'admin_bid_for_member',
  'session_start',
  'session_complete',
  'members_import',
  'credentials_import',
  'targetsolutions_mapping',
  'targetsolutions_apply',
  'credential_create',
  'credential_update',
  'organization_change',
  'positions_clone',
  'rule_book_clone',
  'bid_configuration_set',
  'annual_policy_published',
  'bid_award_transition',
  'telestaff_apply',
  'qualification_lifecycle',
  'dissent',
  // Plan 07 — Phase 2 A-Day picks.
  'a_day_pick',
  'forced_a_day_pick',
  // Plan 08 — synthetic day markers emitted by the DO.
  'day_start',
  'day_end',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditActorTypeSchema = z.enum(['member', 'admin', 'system', 'ai']);
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

/**
 * Canonical wire shape of an audit event. Keys are snake_case so the
 * canonical JSON output matches the DB column names byte-for-byte; the
 * verifier can therefore reconstruct row-for-row.
 *
 * `seq` is the global per-session sequence (audit_log.seq). It is monotone
 * and gap-free within a session.
 */
export const AuditEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  bid_session_id: z.string().min(1),
  action: AuditActionSchema,
  actor_type: AuditActorTypeSchema,
  actor_id: z.number().int().nullable(),
  target_kind: z.string().nullable().optional(),
  target_id: z.string().nullable().optional(),
  before_state: z.string().nullable().optional(),
  after_state: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  ai_advisory_id: z.string().nullable().optional(),
  client_meta: z.string().nullable().optional(),
  created_at: z.string().min(1),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

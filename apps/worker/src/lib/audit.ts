import { eq, isNull, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../db/index.js';
import { auditLog } from '../db/schema.js';

export type AuditAction =
  | 'pick'
  | 'forced_pick'
  | 'amend_selection'
  | 'pause'
  | 'resume'
  | 'skip'
  | 'override_rule'
  | 'override_cert'
  | 'lock_position'
  | 'unlock_position'
  | 'grant_extension'
  | 'admin_bid_for_member'
  | 'session_start'
  | 'mark_mock'
  | 'mock_session_closed'
  | 'session_complete'
  | 'members_import'
  | 'credentials_import'
  | 'positions_clone'
  | 'rule_book_clone'
  | 'bid_configuration_set'
  | 'annual_policy_published'
  | 'bid_award_transition'
  | 'telestaff_apply'
  | 'qualification_lifecycle'
  | 'dissent'
  | 'a_day_pick'
  | 'forced_a_day_pick'
  | 'portal_writeback_retry'
  | 'portal_writeback_clear'
  | 'rehearsal_finding'
  | 'export_generate'
  | 'setting_change'
  | 'portal_writeback_attempt'
  | 'portal_writeback_outcome';

export type AuditEntry = {
  bidSessionId: string | null;
  actorType: 'member' | 'admin' | 'system' | 'ai';
  actorId: number | null;
  action: AuditAction;
  targetKind?: string | null;
  targetId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
  aiAdvisoryId?: string | null;
  clientMeta?: unknown;
};

/**
 * Builds the audit insert used by a material D1 mutation batch.
 *
 * D1 executes a batch as one transaction. Callers must append this statement
 * to the same batch as the authoritative mutation, never issue a material
 * write and then attempt to audit it separately. The sequence is calculated
 * inside the transaction, so a rejected audit insert rejects the domain write
 * as well.
 */
export function auditInsertStatement(
  d1: D1Database,
  entry: AuditEntry,
  createdAt: Date = new Date(),
): D1PreparedStatement {
  const id = ulid();
  const sessionPredicate =
    entry.bidSessionId === null ? 'bid_session_id IS NULL' : 'bid_session_id = ?';
  const parameters: unknown[] = [
    id,
    entry.bidSessionId,
    entry.actorType,
    entry.actorId ?? null,
    entry.action,
    entry.targetKind ?? null,
    entry.targetId ?? null,
    entry.beforeState != null ? JSON.stringify(entry.beforeState) : null,
    entry.afterState != null ? JSON.stringify(entry.afterState) : null,
    entry.reason ?? null,
    entry.aiAdvisoryId ?? null,
    entry.clientMeta != null ? JSON.stringify(entry.clientMeta) : null,
    Math.floor(createdAt.getTime() / 1_000),
  ];
  if (entry.bidSessionId !== null) parameters.push(entry.bidSessionId);

  return d1
    .prepare(
      `INSERT INTO audit_log
         (id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
          target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at)
       SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM audit_log
        WHERE ${sessionPredicate}`,
    )
    .bind(...parameters);
}

/**
 * Writes a flat audit_log row with a monotonic `seq` scoped to bid_session_id
 * (NULL session is its own scope). Returns the new row's id and seq.
 *
 * Hash chaining and R2 mirroring are Plan 08, not this writer.
 */
export async function writeAuditLog(
  db: DB,
  entry: AuditEntry,
): Promise<{ id: string; seq: number }> {
  const whereSession =
    entry.bidSessionId === null
      ? isNull(auditLog.bidSessionId)
      : eq(auditLog.bidSessionId, entry.bidSessionId);
  const before = await db
    .select({ max: sql<number | null>`max(${auditLog.seq})` })
    .from(auditLog)
    .where(whereSession)
    .get();
  const nextSeq = (before?.max ?? 0) + 1;
  const id = ulid();
  await db.insert(auditLog).values({
    id,
    bidSessionId: entry.bidSessionId,
    seq: nextSeq,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetKind: entry.targetKind ?? null,
    targetId: entry.targetId ?? null,
    beforeState: entry.beforeState != null ? JSON.stringify(entry.beforeState) : null,
    afterState: entry.afterState != null ? JSON.stringify(entry.afterState) : null,
    reason: entry.reason ?? null,
    aiAdvisoryId: entry.aiAdvisoryId ?? null,
    clientMeta: entry.clientMeta != null ? JSON.stringify(entry.clientMeta) : null,
    createdAt: new Date(),
  });
  return { id, seq: nextSeq };
}

export interface AuditRowDraft {
  id: string;
  bidSessionId: string;
  seq: number;
  actorType: 'member' | 'admin' | 'system' | 'ai';
  actorId: number | null;
  action: 'pick' | 'forced_pick' | 'pause' | 'resume' | 'skip' | 'admin_bid_for_member';
  targetKind: string | null;
  targetId: string | null;
  beforeState: string | null;
  afterState: string | null;
  reason: string | null;
  aiAdvisoryId: string | null;
  clientMeta: string | null;
  createdAt: Date;
}

export function auditEntryForPickMade(input: {
  bidSessionId: string;
  seq: number;
  bidId: string;
  memberId: number;
  positionId: string;
  idempotencyKey: string;
  nowMs: number;
}): AuditRowDraft {
  return {
    id: ulid(),
    bidSessionId: input.bidSessionId,
    seq: input.seq,
    actorType: 'member',
    actorId: input.memberId,
    action: 'pick',
    targetKind: 'position',
    targetId: input.positionId,
    beforeState: null,
    afterState: JSON.stringify({ bidId: input.bidId, idempotencyKey: input.idempotencyKey }),
    reason: null,
    aiAdvisoryId: null,
    clientMeta: null,
    createdAt: new Date(input.nowMs),
  };
}

export function auditEntryForForcedPick(input: {
  bidSessionId: string;
  seq: number;
  bidId: string;
  adminActorId: number;
  targetMemberId: number;
  positionId: string;
  reason: string;
  nowMs: number;
}): AuditRowDraft {
  return {
    id: ulid(),
    bidSessionId: input.bidSessionId,
    seq: input.seq,
    actorType: 'admin',
    actorId: input.adminActorId,
    action: 'forced_pick',
    targetKind: 'position',
    targetId: input.positionId,
    beforeState: null,
    afterState: JSON.stringify({ bidId: input.bidId, memberId: input.targetMemberId }),
    reason: input.reason,
    aiAdvisoryId: null,
    clientMeta: null,
    createdAt: new Date(input.nowMs),
  };
}

export function auditEntryForSkip(input: {
  bidSessionId: string;
  seq: number;
  adminActorId: number;
  skippedMemberId: number;
  reason: string;
  nowMs: number;
}): AuditRowDraft {
  return {
    id: ulid(),
    bidSessionId: input.bidSessionId,
    seq: input.seq,
    actorType: 'admin',
    actorId: input.adminActorId,
    action: 'skip',
    targetKind: 'member',
    targetId: String(input.skippedMemberId),
    beforeState: null,
    afterState: null,
    reason: input.reason,
    aiAdvisoryId: null,
    clientMeta: null,
    createdAt: new Date(input.nowMs),
  };
}

export function auditEntryForFreeze(input: {
  bidSessionId: string;
  seq: number;
  adminActorId: number;
  reason: string;
  nowMs: number;
}): AuditRowDraft {
  return {
    id: ulid(),
    bidSessionId: input.bidSessionId,
    seq: input.seq,
    actorType: 'admin',
    actorId: input.adminActorId,
    action: 'pause',
    targetKind: 'session',
    targetId: input.bidSessionId,
    beforeState: null,
    afterState: JSON.stringify({ frozen: true }),
    reason: `freeze: ${input.reason}`,
    aiAdvisoryId: null,
    clientMeta: null,
    createdAt: new Date(input.nowMs),
  };
}

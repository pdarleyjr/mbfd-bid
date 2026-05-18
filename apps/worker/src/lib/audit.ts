import { eq, isNull, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../db/index.js';
import { auditLog } from '../db/schema.js';

export type AuditAction =
  | 'pick'
  | 'forced_pick'
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
  | 'session_complete'
  | 'members_import'
  | 'credentials_import'
  | 'positions_clone'
  | 'rule_book_clone';

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
 * Writes a flat audit_log row with a monotonic `seq` scoped to bid_session_id
 * (NULL session is its own scope). Returns the new row's id and seq.
 *
 * Hash chaining and R2 mirroring are Plan 08, not this writer.
 */
export async function writeAuditLog(
  db: DB,
  entry: AuditEntry,
): Promise<{ id: string; seq: number }> {
  const id = ulid();

  const whereSession =
    entry.bidSessionId === null
      ? isNull(auditLog.bidSessionId)
      : eq(auditLog.bidSessionId, entry.bidSessionId);

  const maxRow = await db
    .select({ max: sql<number | null>`max(${auditLog.seq})` })
    .from(auditLog)
    .where(whereSession)
    .get();

  const nextSeq = (maxRow?.max ?? 0) + 1;

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

// Plan 08 Task 17 — D1 adapter for the audit CSV exporter.

import type { D1Database } from '@cloudflare/workers-types';
import { asc, eq, sql } from 'drizzle-orm';

import { getDb } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import type { AuditCsvDb } from './audit-csv.js';

export function auditCsvDbFromD1(d1: D1Database, bidSessionId: string): AuditCsvDb {
  const db = getDb(d1);
  return {
    async pageRows(offset, limit) {
      const rows = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.bidSessionId, bidSessionId))
        .orderBy(asc(auditLog.seq))
        .limit(limit)
        .offset(offset)
        .all();
      return rows.map((r) => ({
        id: r.id,
        bid_session_id: r.bidSessionId,
        seq: r.seq,
        actor_type: r.actorType,
        actor_id: r.actorId,
        action: r.action,
        target_kind: r.targetKind,
        target_id: r.targetId,
        before_state: r.beforeState,
        after_state: r.afterState,
        reason: r.reason,
        ai_advisory_id: r.aiAdvisoryId,
        client_meta: r.clientMeta,
        created_at: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      }));
    },
    async count() {
      const row = await db
        .select({ n: sql<number>`count(*)` })
        .from(auditLog)
        .where(eq(auditLog.bidSessionId, bidSessionId))
        .get();
      return row?.n ?? 0;
    },
  };
}

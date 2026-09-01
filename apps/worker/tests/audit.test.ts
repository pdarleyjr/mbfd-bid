import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../src/db/index.js';
import { auditLog } from '../src/db/schema.js';
import { auditInsertStatement, writeAuditLog } from '../src/lib/audit.js';
import { setupTestD1, teardownTestD1 } from './integration/helpers/test-d1.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

function makeD1Adapter(sqlite: Database.Database): D1Database {
  return {
    prepare: (query: string) => {
      const stmt = sqlite.prepare(query);
      let boundArgs: unknown[] = [];
      const bound = {
        bind: (...args: unknown[]) => {
          boundArgs = args;
          return bound;
        },
        run: async () => {
          const info = stmt.run(...boundArgs);
          return {
            success: true,
            meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
          };
        },
        all: async () => {
          const results = stmt.all(...boundArgs) as Record<string, unknown>[];
          return { results, success: true, meta: {} };
        },
        first: async () => {
          const r = stmt.get(...boundArgs) as Record<string, unknown> | undefined;
          return r ?? null;
        },
        raw: async <T = unknown[]>() => {
          const stmtRaw = sqlite.prepare(query);
          return stmtRaw.raw().all(...boundArgs) as T[];
        },
      };
      return bound;
    },
    batch: async (stmts: D1PreparedStatement[]) => {
      return stmts.map(() => ({ success: true, results: [], meta: {} })) as unknown as D1Result[];
    },
    exec: async (q: string) => {
      sqlite.exec(q);
      return { count: 0, duration: 0 } as D1ExecResult;
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function applyMigrations(sqlite: Database.Database): void {
  const files = [
    '0001_init.sql',
    '0002_members_certs.sql',
    '0003_positions_rules.sql',
    '0004_bid_audit_ai.sql',
    '0005_audit_log_session_nullable.sql',
    '0013_audit_chain_bookkeeping.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .flatMap((chunk) => chunk.split(';'))
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));
    for (const stmt of statements) {
      try {
        sqlite.exec(`${stmt};`);
      } catch {
        // ignore already-exists errors for idempotency
      }
    }
  }
}

function makeTestDb() {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite);
  const d1 = makeD1Adapter(sqlite);
  return { sqlite, d1 };
}

function seedBidSessions(sqlite: Database.Database, ...sessionIds: string[]): void {
  sqlite.prepare('INSERT INTO bid_years (year, status) VALUES (?, ?)').run(2026, 'draft');
  const insertSession = sqlite.prepare(
    'INSERT INTO bid_sessions (id, bid_year, started_at, current_phase) VALUES (?, ?, ?, ?)',
  );
  for (const sessionId of sessionIds) {
    insertSession.run(sessionId, 2026, 1, 'config');
  }
}

describe('writeAuditLog', () => {
  it('rolls back a material mutation when its batched audit insert faults', async () => {
    const h = await setupTestD1();
    try {
      h.failNextBatchAt(1);
      await expect(
        h.env.DB.batch([
          h.env.DB.prepare('INSERT INTO credentials (name, fy_points_default) VALUES (?, ?)').bind(
            'Audit fault credential',
            1,
          ),
          auditInsertStatement(h.env.DB, {
            bidSessionId: null,
            actorType: 'admin',
            actorId: 1,
            action: 'credentials_import',
            targetKind: 'credential_import',
            targetId: 'audit-fault-test',
          }),
        ]),
      ).rejects.toThrow('injected D1 batch failure');

      expect(
        (await h.db.run('SELECT name FROM credentials WHERE name = ?', ['Audit fault credential']))
          .results,
      ).toHaveLength(0);
      expect((await h.db.run('SELECT id FROM audit_log')).results).toHaveLength(0);
    } finally {
      await teardownTestD1(h);
    }
  });

  it('inserts a row with monotonic seq scoped to bid_session_id', async () => {
    const { sqlite, d1 } = makeTestDb();
    seedBidSessions(sqlite, 'session-abc', 'session-xyz');
    const db = getDb(d1);

    const a = await writeAuditLog(db, {
      bidSessionId: 'session-abc',
      actorType: 'admin',
      actorId: 42,
      action: 'pick',
    });
    expect(a.seq).toBe(1);

    const b = await writeAuditLog(db, {
      bidSessionId: 'session-abc',
      actorType: 'admin',
      actorId: 42,
      action: 'pick',
    });
    expect(b.seq).toBe(2);

    const c = await writeAuditLog(db, {
      bidSessionId: 'session-xyz',
      actorType: 'admin',
      actorId: 42,
      action: 'pick',
    });
    expect(c.seq).toBe(1); // different session, new seq
  });

  it('accepts null bid_session_id and assigns global monotonic seq', async () => {
    const { d1 } = makeTestDb();
    const db = getDb(d1);

    const a = await writeAuditLog(db, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: 42,
      action: 'members_import',
    });
    const b = await writeAuditLog(db, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: 42,
      action: 'members_import',
    });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
  });

  it('captures actorType, action, target, beforeState, afterState, reason', async () => {
    const { d1 } = makeTestDb();
    const db = getDb(d1);
    const r = await writeAuditLog(db, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: 7,
      action: 'positions_clone',
      targetKind: 'position_template',
      targetId: '2026.1',
      beforeState: null,
      afterState: { destVersion: '2026.1', copied: 230 },
      reason: 'cloned from 2025.1',
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.id, r.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('positions_clone');
    expect(JSON.parse(rows[0]?.afterState ?? '{}')).toMatchObject({
      destVersion: '2026.1',
      copied: 230,
    });
  });

  it('returns the id of the inserted row', async () => {
    const { d1 } = makeTestDb();
    const db = getDb(d1);
    const r = await writeAuditLog(db, {
      bidSessionId: null,
      actorType: 'system',
      actorId: null,
      action: 'rule_book_clone',
    });
    expect(typeof r.id).toBe('string');
    expect(r.id.length).toBeGreaterThan(0);
  });

  it('null scope and session scope do not share seq counters', async () => {
    const { sqlite, d1 } = makeTestDb();
    seedBidSessions(sqlite, 'session-001');
    const db = getDb(d1);

    await writeAuditLog(db, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: 1,
      action: 'members_import',
    });
    await writeAuditLog(db, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: 1,
      action: 'members_import',
    });

    const c = await writeAuditLog(db, {
      bidSessionId: 'session-001',
      actorType: 'admin',
      actorId: 1,
      action: 'pick',
    });
    expect(c.seq).toBe(1); // separate scope
  });
});

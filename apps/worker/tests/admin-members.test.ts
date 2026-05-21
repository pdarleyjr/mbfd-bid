import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JwtPayload } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { signJwt } from '../src/lib/jwt.js';
import membersRouter from '../src/routes/admin/members.js';
import type { WorkerEnv } from '../src/types/env';

const KEY = 'a'.repeat(64);

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

/** Wraps better-sqlite3 to look like a D1Database for Drizzle's D1 driver. */
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

/** Apply migration SQL files in order (strips drizzle-kit statement-break markers). */
function applyMigrations(sqlite: Database.Database): void {
  const files = [
    '0001_init.sql',
    '0002_members_certs.sql',
    '0003_positions_rules.sql',
    '0004_bid_audit_ai.sql',
    '0005_audit_log_session_nullable.sql',
    '0013_audit_chain_bookkeeping.sql',
    '0018_members_prior_position.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8');
    // drizzle-kit adds `--> statement-breakpoint` markers; split on those + semicolons.
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

function mkEnv(sqlite: Database.Database): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: KEY,
    PIN_HASH: '$2b$12$placeholder',
    PORTAL_BID_READER: 'tok',
    CF_AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/test/mbfd-bid/anthropic',
    ANTHROPIC_API_KEY: 'sk-test',
    AI_BUDGET_CAP_CENTS: 2500,
    AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    DB: makeD1Adapter(sqlite),
    KV: {} as never,
    BID_SESSION: {} as never,
    AI_KV: {} as never,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    AI: {} as never,
    BROWSER: {} as never,
  };
}

function makeApp() {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite);

  const app = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
  app.route('/admin/members', membersRouter);

  return { app, sqlite };
}

const BASE_PAYLOAD = {
  sub: 1,
  emp: '14335',
  rank: 'DC' as const,
  first_name: 'Jesus',
  last_name: 'Sola',
  fresh_auth_at: Math.floor(Date.now() / 1000),
};

const SAMPLE_CSV = `Employee Id,Last Name,First Name,Current Rank,Bid Category,Bid,RscSeniorityIn
14335,Sola,Jesus,Division Chief,OFC,Include,4
99999,BadRow,Tester,UnknownRank,OFC,Include,5
20001,Smith,John,Captain,FF,Include,7`;

describe('admin members routes', () => {
  it('GET /admin/members returns 401 without auth', async () => {
    const { app, sqlite } = makeApp();
    const res = await app.request('/admin/members', {}, mkEnv(sqlite));
    expect(res.status).toBe(401);
  });

  it('GET /admin/members returns 403 for role=member', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'member' }, KEY);
    const res = await app.request(
      '/admin/members',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(403);
  });

  it('GET /admin/members returns empty array for fresh DB', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/members',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: unknown[]; total: number };
    expect(body.members).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('POST /admin/members/import upserts members and returns counts', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const form = new FormData();
    form.append('file', new Blob([SAMPLE_CSV], { type: 'text/csv' }), 'members.csv');
    const res = await app.request(
      '/admin/members/import',
      { method: 'POST', body: form, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inserted: number;
      updated: number;
      errors: { rowNumber: number }[];
    };
    expect(body.inserted).toBe(2); // 14335 (DC) and 20001 (CPT) are valid
    expect(body.updated).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.rowNumber).toBe(3); // BadRow is data row 3 (header=1, first=2, bad=3)

    const auditCount = sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number };
    expect(auditCount.n).toBe(1);
  });

  it('POST /admin/members/import is idempotent — re-running updates instead of duplicating', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const singleRowCsv = `Employee Id,Last Name,First Name,Current Rank,Bid Category,Bid,RscSeniorityIn
14335,Sola,Jesus,Division Chief,OFC,Include,4`;

    const form1 = new FormData();
    form1.append('file', new Blob([singleRowCsv], { type: 'text/csv' }), 'members.csv');
    await app.request(
      '/admin/members/import',
      { method: 'POST', body: form1, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );

    const form2 = new FormData();
    form2.append('file', new Blob([singleRowCsv], { type: 'text/csv' }), 'members.csv');
    const res2 = await app.request(
      '/admin/members/import',
      { method: 'POST', body: form2, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    const body2 = (await res2.json()) as { inserted: number; updated: number; errors: unknown[] };
    expect(body2.inserted).toBe(0);
    expect(body2.updated).toBe(1);
  });

  it('GET /admin/members/:id returns 404 when member not found', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/members/9999',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(404);
  });

  it('GET /admin/members?bid_category=OFC filters by bid category', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const csv = `Employee Id,Last Name,First Name,Current Rank,Bid Category,Bid,RscSeniorityIn
14335,Sola,Jesus,Division Chief,OFC,Include,4
20001,Smith,John,Captain,FF,Include,7`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'members.csv');
    await app.request(
      '/admin/members/import',
      { method: 'POST', body: form, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );

    const res = await app.request(
      '/admin/members?bid_category=OFC',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: { bidCategory: string }[]; total: number };
    expect(body.members).toHaveLength(1);
    expect(body.members[0]?.bidCategory).toBe('OFC');
  });

  it('GET /admin/members/:id returns the member when found', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const csv = `Employee Id,Last Name,First Name,Current Rank,Bid Category,Bid,RscSeniorityIn
14335,Sola,Jesus,Division Chief,OFC,Include,4`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'members.csv');
    await app.request(
      '/admin/members/import',
      { method: 'POST', body: form, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );

    // Get the inserted member's id from the list
    const listRes = await app.request(
      '/admin/members',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    const listBody = (await listRes.json()) as { members: { id: number; employeeId: string }[] };
    const insertedId = listBody.members[0]?.id;
    expect(insertedId).toBeDefined();

    const res = await app.request(
      `/admin/members/${insertedId}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { member: { employeeId: string } };
    expect(body.member.employeeId).toBe('14335');
  });
});

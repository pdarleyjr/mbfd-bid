import { readFileSync, readdirSync } from 'node:fs';
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
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(
      readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
  }
}

function mkEnv(sqlite: Database.Database): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: KEY,
    PORTAL_BID_READER: 'tok',
    DB: makeD1Adapter(sqlite),
    KV: {} as never,
    BID_SESSION: {} as never,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
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

function seedMember(
  sqlite: Database.Database,
  values: Partial<{
    employeeId: string;
    firstName: string;
    lastName: string;
    rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
    bidCategory: 'OFC' | 'FF' | 'EXCLUDED';
    rscSeniority: number;
  }> = {},
): number {
  const now = Date.now();
  const result = sqlite
    .prepare(
      `INSERT INTO members (
        employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
        is_probationary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.employeeId ?? '14335',
      values.firstName ?? 'Jesus',
      values.lastName ?? 'Sola',
      values.rank ?? 'DC',
      values.bidCategory ?? 'OFC',
      values.rscSeniority ?? 4,
      0,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

function seedCredential(sqlite: Database.Database, name = 'Test credential'): number {
  const result = sqlite.prepare('INSERT INTO credentials (name) VALUES (?)').run(name);
  return Number(result.lastInsertRowid);
}

function memberWriteCounts(sqlite: Database.Database) {
  const count = (table: 'members' | 'member_credentials' | 'audit_log') =>
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return {
    members: count('members'),
    memberCredentials: count('member_credentials'),
    audit: count('audit_log'),
  };
}

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

  it('retires legacy CSV import before parsing and leaves members and audit evidence untouched', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const form = new FormData();
    form.append('file', new Blob([SAMPLE_CSV], { type: 'text/csv' }), 'members.csv');
    const before = memberWriteCounts(sqlite);
    const res = await app.request(
      '/admin/members/import',
      { method: 'POST', body: form, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({
      error: 'legacy_member_write_retired',
      operation: 'member_import',
      operator_workflows: { telestaff: { ui: '/admin/telestaff' } },
    });
    expect(memberWriteCounts(sqlite)).toEqual(before);
  });

  it('retires synthesis bootstrap before it can mutate current members or credentials', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const before = memberWriteCounts(sqlite);
    const res = await app.request(
      '/admin/members/seed-from-synthesis',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: [{ employee_id: '14335' }] }),
      },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({
      error: 'legacy_member_write_retired',
      operation: 'synthesis_seed',
      operator_workflows: { telestaff: { api: '/api/admin/telestaff/imports' } },
    });
    expect(memberWriteCounts(sqlite)).toEqual(before);
  });

  it('retires legacy member PATCH before parsing and leaves the projection and audit untouched', async () => {
    const { app, sqlite } = makeApp();
    const memberId = seedMember(sqlite);
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const beforeMember = sqlite.prepare('SELECT * FROM members WHERE id = ?').get(memberId);
    const before = memberWriteCounts(sqlite);
    const res = await app.request(
      `/admin/members/${memberId}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: '{not-json',
      },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({
      error: 'legacy_member_write_retired',
      operation: 'member_patch',
      operator_workflows: { personnel: { api: '/api/admin/personnel/changes' } },
    });
    expect(sqlite.prepare('SELECT * FROM members WHERE id = ?').get(memberId)).toEqual(
      beforeMember,
    );
    expect(memberWriteCounts(sqlite)).toEqual(before);
  });

  it('retires direct credential toggles with no credential or audit mutation', async () => {
    const { app, sqlite } = makeApp();
    const memberId = seedMember(sqlite);
    const credentialId = seedCredential(sqlite);
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const before = memberWriteCounts(sqlite);
    const res = await app.request(
      `/admin/members/${memberId}/credentials/${credentialId}`,
      { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({
      error: 'legacy_member_write_retired',
      operation: 'credential_change',
      credential_lifecycle: {
        status: 'configured',
        api: '/api/admin/qualification-lifecycle/events',
      },
    });
    expect(memberWriteCounts(sqlite)).toEqual(before);
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
    seedMember(sqlite, { employeeId: '14335', bidCategory: 'OFC' });
    seedMember(sqlite, {
      employeeId: '20001',
      firstName: 'John',
      lastName: 'Smith',
      rank: 'CPT',
      bidCategory: 'FF',
      rscSeniority: 7,
    });

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
    const insertedId = seedMember(sqlite);

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

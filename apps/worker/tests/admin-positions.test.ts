import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JwtPayload } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { signJwt } from '../src/lib/jwt.js';
import positionsRouter from '../src/routes/admin/positions.js';
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
  };
}

function makeApp() {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite);

  const app = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
  app.route('/admin/positions', positionsRouter);

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

/** Seed a position_template and positions into the sqlite DB directly. */
function seedTemplate(
  sqlite: Database.Database,
  version: string,
  year: number,
  posRows: Array<{
    id: string;
    shift: string;
    station: string;
    division?: string;
    unit?: string;
    rankRequired?: string;
    positionName?: string;
  }>,
) {
  sqlite
    .prepare('INSERT INTO position_templates (version, effective_year) VALUES (?, ?)')
    .run(version, year);
  const insert = sqlite.prepare(
    `INSERT INTO positions
      (id, template_version, shift, station, division, unit, rank_required, position_name,
       is_floating, is_vacant_by_design, is_excluded_from_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
  );
  for (const p of posRows) {
    insert.run(
      p.id,
      version,
      p.shift,
      p.station,
      p.division ?? 'Combat',
      p.unit ?? 'Engine',
      p.rankRequired ?? 'FF',
      p.positionName ?? `Position ${p.id}`,
    );
  }
}

describe('admin positions routes', () => {
  it('GET /admin/positions returns 401 without auth', async () => {
    const { app, sqlite } = makeApp();
    const res = await app.request('/admin/positions', {}, mkEnv(sqlite));
    expect(res.status).toBe(401);
  });

  it('GET /admin/positions returns 403 for role=member', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'member' }, KEY);
    const res = await app.request(
      '/admin/positions',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(403);
  });

  it('GET /admin/positions returns 400 when template_version missing', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/positions',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/template_version/);
  });

  it('GET /admin/positions returns empty positions for unknown template_version', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/positions?template_version=9999.9',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      positions: unknown[];
      templateVersion: string;
      count: number;
    };
    expect(body.positions).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.templateVersion).toBe('9999.9');
  });

  it('GET /admin/positions returns all positions for a template', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedTemplate(sqlite, '2026.1', 2026, [
      { id: 'P001', shift: 'A', station: '1' },
      { id: 'P002', shift: 'B', station: '2' },
      { id: 'P003', shift: 'A', station: '2' },
    ]);
    const res = await app.request(
      '/admin/positions?template_version=2026.1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      positions: { id: string }[];
      templateVersion: string;
      count: number;
    };
    expect(body.count).toBe(3);
    expect(body.templateVersion).toBe('2026.1');
  });

  it('GET /admin/positions?shift=A filters by shift', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedTemplate(sqlite, '2026.1', 2026, [
      { id: 'P001', shift: 'A', station: '1' },
      { id: 'P002', shift: 'B', station: '1' },
      { id: 'P003', shift: 'A', station: '2' },
    ]);
    const res = await app.request(
      '/admin/positions?template_version=2026.1&shift=A',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { positions: { shift: string }[]; count: number };
    expect(body.count).toBe(2);
    for (const p of body.positions) {
      expect(p.shift).toBe('A');
    }
  });

  it('GET /admin/positions?station=1 filters by station', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedTemplate(sqlite, '2026.1', 2026, [
      { id: 'P001', shift: 'A', station: '1' },
      { id: 'P002', shift: 'B', station: '2' },
      { id: 'P003', shift: 'C', station: '1' },
    ]);
    const res = await app.request(
      '/admin/positions?template_version=2026.1&station=1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { positions: { station: string }[]; count: number };
    expect(body.count).toBe(2);
    for (const p of body.positions) {
      expect(p.station).toBe('1');
    }
  });

  it('GET /admin/positions can combine shift and station filters', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedTemplate(sqlite, '2026.1', 2026, [
      { id: 'P001', shift: 'A', station: '1' },
      { id: 'P002', shift: 'A', station: '2' },
      { id: 'P003', shift: 'B', station: '1' },
    ]);
    const res = await app.request(
      '/admin/positions?template_version=2026.1&shift=A&station=1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { positions: { id: string }[]; count: number };
    expect(body.count).toBe(1);
    expect(body.positions[0]?.id).toBe('P001');
  });

  it('POST /admin/positions/clone-from-year/:src returns 401 without auth', async () => {
    const { app, sqlite } = makeApp();
    const res = await app.request(
      '/admin/positions/clone-from-year/2026.1',
      { method: 'POST', body: JSON.stringify({ destVersion: '2027.1', destYear: 2027 }) },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(401);
  });

  it('POST /admin/positions/clone-from-year returns 404 when src template missing', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/positions/clone-from-year/9999.1',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destVersion: '2027.1', destYear: 2027 }),
      },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('src_version_not_found');
  });

  it('POST /admin/positions/clone-from-year returns 409 when dest already exists', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedTemplate(sqlite, '2026.1', 2026, [{ id: 'P001', shift: 'A', station: '1' }]);
    seedTemplate(sqlite, '2027.1', 2027, []);
    const res = await app.request(
      '/admin/positions/clone-from-year/2026.1',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destVersion: '2027.1', destYear: 2027 }),
      },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('dest_version_already_exists');
  });

  it('POST /admin/positions/clone-from-year copies all positions and creates new template', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedTemplate(sqlite, '2026.1', 2026, [
      { id: 'P001', shift: 'A', station: '1' },
      { id: 'P002', shift: 'B', station: '2' },
      { id: 'P003', shift: 'C', station: '3' },
    ]);
    const res = await app.request(
      '/admin/positions/clone-from-year/2026.1',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destVersion: '2027.1', destYear: 2027 }),
      },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      destVersion: string;
      destYear: number;
      copied: number;
    };
    expect(body.destVersion).toBe('2027.1');
    expect(body.destYear).toBe(2027);
    expect(body.copied).toBe(3);

    // Verify positions were inserted into dest template by fetching via GET
    const listRes = await app.request(
      '/admin/positions?template_version=2027.1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { count: number };
    expect(listBody.count).toBe(3);

    const auditCount = sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number };
    expect(auditCount.n).toBe(1);
  });

  it('POST /admin/positions/clone-from-year returns 400 when body missing destVersion', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedTemplate(sqlite, '2026.1', 2026, []);
    const res = await app.request(
      '/admin/positions/clone-from-year/2026.1',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ destYear: 2027 }),
      },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(400);
  });
});

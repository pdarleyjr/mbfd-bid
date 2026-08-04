import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JwtPayload } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { signJwt } from '../src/lib/jwt.js';
import rulesRouter from '../src/routes/admin/rules.js';
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

function mkEnv(sqlite: Database.Database): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: KEY,
    PIN_HASH: '$2b$12$placeholder',
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
  app.route('/admin/rules', rulesRouter);

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

/** Seed a rule_book and position_rules rows. */
function seedRuleBook(
  sqlite: Database.Database,
  version: string,
  year: number,
  rules: Array<{
    positionId: string;
    templateVersion: string;
    requiredCriteriaJson?: string;
    pointsPreferenceJson?: string;
    tieBreakChainJson?: string;
    notes?: string | null;
  }>,
) {
  sqlite
    .prepare('INSERT INTO rule_books (version, effective_year) VALUES (?, ?)')
    .run(version, year);
  const insert = sqlite.prepare(
    `INSERT INTO position_rules
      (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rules) {
    insert.run(
      version,
      r.positionId,
      r.templateVersion,
      r.requiredCriteriaJson ?? '{"rank":"FF"}',
      r.pointsPreferenceJson ?? '[]',
      r.tieBreakChainJson ?? '[]',
      r.notes ?? null,
    );
  }
}

describe('admin rules routes', () => {
  it('GET /admin/rules returns 401 without auth', async () => {
    const { app, sqlite } = makeApp();
    const res = await app.request('/admin/rules', {}, mkEnv(sqlite));
    expect(res.status).toBe(401);
  });

  it('GET /admin/rules returns 403 for role=member', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'member' }, KEY);
    const res = await app.request(
      '/admin/rules',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(403);
  });

  it('GET /admin/rules returns 400 when rule_book_version missing', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/rules',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rule_book_version/);
  });

  it('GET /admin/rules returns empty rules for unknown rule_book_version', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/rules?rule_book_version=9999.9',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rules: unknown[];
      ruleBookVersion: string;
      count: number;
    };
    expect(body.rules).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.ruleBookVersion).toBe('9999.9');
  });

  it('GET /admin/rules returns rules with parsed JSON fields (not raw strings)', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedRuleBook(sqlite, '2026.1', 2026, [
      {
        positionId: 'P001',
        templateVersion: '2026.1',
        requiredCriteriaJson: '{"rank":"FF","certs":["Hazmat"]}',
        pointsPreferenceJson: '[{"credential":"Hazmat Tech","points":4}]',
        tieBreakChainJson: '["rsc_seniority","hired_at"]',
      },
    ]);
    const res = await app.request(
      '/admin/rules?rule_book_version=2026.1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rules: {
        requiredCriteria: unknown;
        pointsPreference: unknown;
        tieBreakChain: unknown;
      }[];
      ruleBookVersion: string;
      count: number;
    };
    expect(body.count).toBe(1);
    expect(body.ruleBookVersion).toBe('2026.1');

    const rule = body.rules[0];
    expect(rule).toBeDefined();
    // Fields must be parsed objects, NOT strings
    expect(typeof rule?.requiredCriteria).toBe('object');
    expect(typeof rule?.pointsPreference).toBe('object');
    expect(typeof rule?.tieBreakChain).toBe('object');
    expect(Array.isArray(rule?.tieBreakChain)).toBe(true);
  });

  it('GET /admin/rules returns all rules for a rule book', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedRuleBook(sqlite, '2026.1', 2026, [
      { positionId: 'P001', templateVersion: '2026.1' },
      { positionId: 'P002', templateVersion: '2026.1' },
      { positionId: 'P003', templateVersion: '2026.1' },
    ]);
    const res = await app.request(
      '/admin/rules?rule_book_version=2026.1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: unknown[]; count: number };
    expect(body.count).toBe(3);
  });

  it('GET /admin/rules/:id returns 404 for unknown id', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/rules/9999',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('GET /admin/rules/:id returns the rule with parsed JSON fields', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    seedRuleBook(sqlite, '2026.1', 2026, [
      {
        positionId: 'P001',
        templateVersion: '2026.1',
        requiredCriteriaJson: '{"rank":"LT"}',
        pointsPreferenceJson: '[{"credential":"Acting Lt","points":2}]',
        tieBreakChainJson: '["rsc_seniority"]',
        notes: 'Test note',
      },
    ]);

    // Get the inserted id via list endpoint
    const listRes = await app.request(
      '/admin/rules?rule_book_version=2026.1',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    const listBody = (await listRes.json()) as { rules: { id: number }[] };
    const insertedId = listBody.rules[0]?.id;
    expect(insertedId).toBeDefined();

    const res = await app.request(
      `/admin/rules/${insertedId}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rule: {
        id: number;
        ruleBookVersion: string;
        positionId: string;
        requiredCriteria: unknown;
        pointsPreference: unknown;
        tieBreakChain: unknown;
        notes: string | null;
      };
    };
    expect(body.rule.id).toBe(insertedId);
    expect(body.rule.ruleBookVersion).toBe('2026.1');
    expect(body.rule.positionId).toBe('P001');
    expect(typeof body.rule.requiredCriteria).toBe('object');
    expect(typeof body.rule.pointsPreference).toBe('object');
    expect(Array.isArray(body.rule.tieBreakChain)).toBe(true);
    expect(body.rule.notes).toBe('Test note');
  });
});

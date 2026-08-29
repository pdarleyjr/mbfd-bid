import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { WorkerEnv } from '../../../src/types/env.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../../migrations');

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
      // better-sqlite3 transactions can't return a Promise, so we run the
      // statements sequentially in async land. Atomicity is best-effort
      // for tests — production uses D1's native batch.
      const results: unknown[] = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results as unknown as D1Result[];
    },
    exec: async (q: string) => {
      sqlite.exec(q);
      return { count: 0, duration: 0 } as D1ExecResult;
    },
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

/**
 * Apply every migration as one SQLite program. Splitting SQL text on `;`
 * corrupts trigger bodies (`BEGIN ...; END`) and silently omits their
 * integrity guards, so the test harness intentionally mirrors D1's full-file
 * execution semantics instead.
 */
function applyMigrations(sqlite: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function inactiveSpecialtyBidSessionNamespace(): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string) => {
      const url = typeof input === 'string' ? input : input.url;
      const pathname = new URL(url).pathname;
      if (pathname === '/admin/normal-mutation-lease/acquire') {
        return new Response(JSON.stringify({ ok: true, lease_id: 'test-normal-mutation-lease' }), {
          status: 200,
        });
      }
      if (pathname === '/admin/normal-mutation-lease/release') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (pathname === '/admin/specialty-adjudication') {
        return new Response(
          JSON.stringify({
            mode: 'synthetic_test_only',
            does_not_commit_bid: true,
            database_audit_log: 'not_written',
            state: {
              version: 1,
              revision: 0,
              active: null,
              consumedCommandIds: [],
              processedRequestIds: [],
              resumedRequestIds: [],
            },
            audit_receipts: [],
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
  } as unknown as WorkerEnv['BID_SESSION'];
}

/**
 * In-memory D1 harness for integration tests. Returns an object with:
 *   - `env`: a `WorkerEnv` (DB-only; KV / BID_SESSION are stubs) for passing
 *     to `app.fetch(req, env)`.
 *   - `db`: a small SQL runner the test can use to seed and assert directly.
 *     Use `db.run(sql, params?)` for INSERT/UPDATE/DELETE/SELECT; `.results`
 *     is populated for SELECT.
 *   - `sqlite`: the raw better-sqlite3 handle if a test needs lower-level
 *     access.
 *
 * Call `teardownTestD1(h)` in `afterEach` to release the DB.
 */
export interface TestD1 {
  env: WorkerEnv;
  db: {
    run(sql: string, params?: readonly unknown[]): Promise<{ results: Record<string, unknown>[] }>;
  };
  sqlite: Database.Database;
}

export async function setupTestD1(): Promise<TestD1> {
  const sqlite = new Database(':memory:');
  // Match Cloudflare D1 test behavior: FK pragma is OFF unless the worker
  // explicitly turns it on. The synthetic admin actor (sub: 0) is not a
  // real member row, so enforcing FKs on admin_actor_id would falsely fail
  // forced-pick tests.
  sqlite.pragma('foreign_keys = OFF');
  applyMigrations(sqlite);
  // Migration 0017 idempotently seeds bid_years for 2026/2027/2028 so a
  // fresh production deploy can create a mock session without a manual
  // INSERT. Tests manage their own bid_years rows (often with a non-default
  // status like 'live'), so wipe the seed rows here for test isolation.
  sqlite.exec('DELETE FROM bid_years;');

  const env: WorkerEnv = {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'b'.repeat(64),
    PORTAL_BID_READER: 'tok',
    DB: makeD1Adapter(sqlite),
    KV: {} as never,
    BID_SESSION: inactiveSpecialtyBidSessionNamespace(),
    // Plan 08 — audit + exports + portal bindings/secrets (test placeholders).
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    BROWSER: {} as never,
  };

  return {
    env,
    sqlite,
    db: {
      async run(sql: string, params?: readonly unknown[]) {
        if (/^\s*select/i.test(sql)) {
          const stmt = sqlite.prepare(sql);
          const results = (params ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[];
          return { results };
        }
        // For multi-statement INSERT scripts (no params), use exec(); for
        // parameterized runs, use prepare().run().
        if (params === undefined) {
          sqlite.exec(sql);
          return { results: [] };
        }
        const stmt = sqlite.prepare(sql);
        stmt.run(...params);
        return { results: [] };
      },
    },
  };
}

export async function teardownTestD1(h: TestD1): Promise<void> {
  h.sqlite.close();
}

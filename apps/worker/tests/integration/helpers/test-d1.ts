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
 * Strips full-line `--` comments from a SQL string. Multi-line statements
 * commonly interleave comments and DDL, and splitting on `;` first leaves
 * leading comments stuck to the next statement, which then mis-classifies
 * the whole chunk as a comment. Stripping line-by-line first avoids that.
 */
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
}

/** Apply all migration SQL files in order (strips drizzle-kit statement-break markers). */
function applyMigrations(sqlite: Database.Database): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
    const statements = sql
      .split('--> statement-breakpoint')
      .flatMap((chunk) => chunk.split(';'))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        sqlite.exec(`${stmt};`);
      } catch {
        // ignore already-exists / column-exists noise across migration replays
      }
    }
  }
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
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);

  const env: WorkerEnv = {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'b'.repeat(64),
    PIN_HASH: '$2b$12$placeholder',
    PORTAL_BID_READER: 'tok',
    DB: makeD1Adapter(sqlite),
    KV: {} as never,
    BID_SESSION: {} as never,
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

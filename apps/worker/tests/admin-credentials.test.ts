import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JwtPayload } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { signJwt } from '../src/lib/jwt.js';
import credentialsRouter from '../src/routes/admin/credentials.js';
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
  app.route('/admin/credentials', credentialsRouter);

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

/** Build a normalized XLSX buffer with the given rows. */
function buildNormalizedXlsx(rows: Record<string, unknown>[]): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Build a legacy wide-matrix XLSX. First row is headers; subsequent rows are data. */
function buildWideMatrixXlsx(headerRow: string[], dataRows: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('admin credentials routes', () => {
  it('GET /admin/credentials returns 401 without auth', async () => {
    const { app, sqlite } = makeApp();
    const res = await app.request('/admin/credentials', {}, mkEnv(sqlite));
    expect(res.status).toBe(401);
  });

  it('GET /admin/credentials returns 403 for role=member', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'member' }, KEY);
    const res = await app.request(
      '/admin/credentials',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(403);
  });

  it('GET /admin/credentials returns empty array for fresh DB', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/credentials',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credentials: unknown[]; total: number };
    expect(body.credentials).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('POST /admin/credentials/import (normalized) upserts valid rows and reports errors', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);

    const xlsxBytes = buildNormalizedXlsx([
      { name: 'Driver Engineer Qualified', fy_points_default: 4 },
      { name: 'Hazmat Tech', fy_points_default: 6 },
      { name: 'Acting Lt', fy_points_default: 0 },
      { name: '', fy_points_default: 1 }, // invalid — empty name
    ]);

    const form = new FormData();
    form.append(
      'file',
      new Blob([xlsxBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'creds.xlsx',
    );

    const res = await app.request(
      '/admin/credentials/import',
      { method: 'POST', body: form, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inserted: number;
      updated: number;
      errors: { rowNumber: number }[];
    };
    expect(body.inserted).toBe(3);
    expect(body.updated).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.rowNumber).toBe(5); // row 1=header, 2-4=valid, 5=invalid

    const auditCount = sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number };
    expect(auditCount.n).toBe(1);
  });

  it('POST /admin/credentials/import is idempotent — re-running updates instead of inserting', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);

    const xlsxBytes = buildNormalizedXlsx([
      { name: 'Driver Engineer Qualified', fy_points_default: 4 },
      { name: 'Hazmat Tech', fy_points_default: 6 },
      { name: 'Acting Lt', fy_points_default: 0 },
      { name: '', fy_points_default: 1 }, // invalid
    ]);

    const makeForm = () => {
      const form = new FormData();
      form.append(
        'file',
        new Blob([xlsxBytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        'creds.xlsx',
      );
      return form;
    };

    // First import
    await app.request(
      '/admin/credentials/import',
      { method: 'POST', body: makeForm(), headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );

    // Second import — same data
    const res2 = await app.request(
      '/admin/credentials/import',
      { method: 'POST', body: makeForm(), headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { inserted: number; updated: number; errors: unknown[] };
    expect(body2.inserted).toBe(0);
    expect(body2.updated).toBe(3);
  });

  it('POST /admin/credentials/import in legacy_wide_matrix mode inserts credential names from header row', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);

    const xlsxBytes = buildWideMatrixXlsx(
      ['Employee Id', 'Last Name', 'First Name', 'Hazmat Tech', 'Swift Water Rescue', 'Acting Lt'],
      [
        ['14335', 'Sola', 'Jesus', 1, 0, 1],
        ['20001', 'Smith', 'John', 0, 1, 0],
      ],
    );

    const form = new FormData();
    form.append(
      'file',
      new Blob([xlsxBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'matrix.xlsx',
    );

    const res = await app.request(
      '/admin/credentials/import?mode=legacy_wide_matrix&metadata_columns=3',
      { method: 'POST', body: form, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inserted: number;
      updated: number;
      errors: unknown[];
    };
    expect(body.inserted).toBe(3); // Hazmat Tech, Swift Water Rescue, Acting Lt
    expect(body.updated).toBe(0);
    expect(body.errors).toHaveLength(0);
  });

  it('GET /admin/credentials/:id returns 404 when credential not found', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request(
      '/admin/credentials/9999',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(404);
  });

  it('GET /admin/credentials/:id returns the record after insert', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);

    const xlsxBytes = buildNormalizedXlsx([{ name: 'Hazmat Awareness', fy_points_default: 2 }]);
    const form = new FormData();
    form.append(
      'file',
      new Blob([xlsxBytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'creds.xlsx',
    );
    await app.request(
      '/admin/credentials/import',
      { method: 'POST', body: form, headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );

    // Get the inserted credential's id from the list
    const listRes = await app.request(
      '/admin/credentials',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    const listBody = (await listRes.json()) as { credentials: { id: number; name: string }[] };
    const insertedId = listBody.credentials[0]?.id;
    expect(insertedId).toBeDefined();

    const res = await app.request(
      `/admin/credentials/${insertedId}`,
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credential: { name: string; fyPointsDefault: number } };
    expect(body.credential.name).toBe('Hazmat Awareness');
    expect(body.credential.fyPointsDefault).toBe(2);
  });
});

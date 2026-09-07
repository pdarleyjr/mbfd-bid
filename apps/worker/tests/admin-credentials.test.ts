import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JwtPayload } from '@mbfd/shared';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { signJwt } from '../src/lib/jwt.js';
import credentialsRouter from '../src/routes/admin/credentials.js';
import type { WorkerEnv } from '../src/types/env';

const KEY = 'a'.repeat(64);

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

/** Wraps better-sqlite3 to look like a D1Database for Drizzle's D1 driver. */
type TestD1Database = D1Database & { failNextBatchAt(statementIndex: number): void };

function makeD1Adapter(sqlite: Database.Database): TestD1Database {
  const synchronousRuns = new WeakMap<object, () => D1Result>();
  let nextBatchFailureAt: number | null = null;
  return {
    prepare: (query: string) => {
      const stmt = sqlite.prepare(query);
      let boundArgs: unknown[] = [];
      const runSynchronously = (): D1Result => {
        const info = stmt.run(...boundArgs);
        return {
          success: true,
          meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
        } as D1Result;
      };
      const bound = {
        bind: (...args: unknown[]) => {
          boundArgs = args;
          return bound;
        },
        run: async () => runSynchronously(),
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
      synchronousRuns.set(bound, runSynchronously);
      return bound;
    },
    batch: async (stmts: D1PreparedStatement[]) => {
      const results: D1Result[] = [];
      const failureAt = nextBatchFailureAt;
      nextBatchFailureAt = null;
      sqlite.transaction(() => {
        for (const [index, statement] of stmts.entries()) {
          if (index === failureAt)
            throw new Error(`injected D1 batch failure at statement ${index}`);
          const run = synchronousRuns.get(statement as unknown as object);
          if (run === undefined) throw new Error('test D1 batch received an unknown statement');
          results.push(run());
        }
      })();
      return results;
    },
    exec: async (q: string) => {
      sqlite.exec(q);
      return { count: 0, duration: 0 } as D1ExecResult;
    },
    dump: async () => new ArrayBuffer(0),
    failNextBatchAt(statementIndex: number) {
      nextBatchFailureAt = statementIndex;
    },
  } as unknown as TestD1Database;
}

/** Apply migration SQL files in order (strips drizzle-kit statement-break markers). */
function applyMigrations(sqlite: Database.Database): void {
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf-8'));
  }
}

function mkEnv(sqlite: Database.Database): WorkerEnv & { DB: TestD1Database } {
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

describe('admin credentials routes', () => {
  it('allows one of two edits, replays the exact receipt, and rejects cross-target key reuse', async () => {
    const { app, sqlite } = makeApp();
    sqlite.exec(
      "INSERT INTO credentials (id, name, fy_points_default) VALUES (901, 'Original', 0), (902, 'Other', 0)",
    );
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const env = mkEnv(sqlite);
    const edit = (key: string, name: string, revision = 0, id = 901) =>
      app.request(
        `/admin/credentials/${id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({
            name,
            fy_points_default: 0,
            expected_revision: revision,
            reason: 'Reviewed display correction',
          }),
        },
        env,
      );
    const responses = await Promise.all([edit('edit-a', 'First'), edit('edit-b', 'Second')]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses[0]?.status === 200 ? 'edit-a' : 'edit-b';
    const name = winner === 'edit-a' ? 'First' : 'Second';
    const accepted = await responses.find((r) => r.status === 200)?.json();
    expect((await edit('edit-next', 'Later', 1)).status).toBe(200);
    const replay = await edit(winner, name);
    expect(await replay.json()).toMatchObject({ ...(accepted as object), replayed: true });
    expect((await edit(winner, name, 0, 902)).status).toBe(409);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 2 });
  });

  it('rolls back metadata and points when its receipt or audit fails', async () => {
    for (const index of [2, 3]) {
      const { app, sqlite } = makeApp();
      sqlite.exec(
        "INSERT INTO credentials (id, name, fy_points_default) VALUES (901, 'Original', 0)",
      );
      const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
      const env = mkEnv(sqlite);
      env.DB.failNextBatchAt(index);
      const response = await app.request(
        '/admin/credentials/901',
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'failed-change',
          },
          body: JSON.stringify({
            name: 'Changed',
            fy_points_default: 5,
            expected_revision: 0,
            reason: 'Reviewed display correction',
          }),
        },
        env,
      );
      expect(response.status).toBe(500);
      expect(sqlite.prepare('SELECT * FROM credential_catalog_metadata').all()).toEqual([]);
      expect(sqlite.prepare('SELECT * FROM credential_catalog_receipts').all()).toEqual([]);
      expect(
        sqlite.prepare('SELECT fy_points_default FROM credentials WHERE id = 901').get(),
      ).toEqual({ fy_points_default: 0 });
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
    }
  });

  it('renames a display label without changing the credential identity used by existing rules', async () => {
    const { app, sqlite } = makeApp();
    sqlite
      .prepare('INSERT INTO credentials (id, name, fy_points_default) VALUES (901, ?, 0)')
      .run('Original Qualification');
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const response = await app.request(
      '/admin/credentials/901',
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'rename-stable-901',
        },
        body: JSON.stringify({
          name: 'Reviewed Display Label',
          fy_points_default: 0,
          reason: 'Correct the display label only',
          expected_revision: 0,
        }),
      },
      mkEnv(sqlite),
    );
    expect(response.status).toBe(200);
    expect(sqlite.prepare('SELECT id, name FROM credentials WHERE id = 901').get()).toEqual({
      id: 901,
      name: 'Original Qualification',
    });
    expect(await response.json()).toMatchObject({
      credential: {
        id: 901,
        name: 'Reviewed Display Label',
        policyName: 'Original Qualification',
        revision: 1,
      },
    });
  });

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

  it('retires unreviewed direct imports without mutating catalog or audit', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    for (const mode of ['normalized', 'legacy_wide_matrix']) {
      const response = await app.request(
        `/admin/credentials/import?mode=${mode}`,
        { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
        mkEnv(sqlite),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: 'reviewed_catalog_import_required' });
    }
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM credentials').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
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

    sqlite.exec("INSERT INTO credentials (name,fy_points_default) VALUES ('Hazmat Awareness',2)");

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

  it('creates and updates a credential through step-up protected, idempotent catalog commands', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const headers = {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'credential-create-001',
    };

    const created = await app.request(
      '/admin/credentials',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Swift Water Rescue',
          fy_points_default: 0,
          reason: 'Catalog review approved this credential.',
        }),
      },
      mkEnv(sqlite),
    );
    expect(created.status).toBe(201);
    const createBody = (await created.json()) as {
      replayed: boolean;
      credential: { id: number; name: string; fyPointsDefault: number; holderCount: number };
    };
    expect(createBody).toMatchObject({
      replayed: false,
      credential: { name: 'Swift Water Rescue', fyPointsDefault: 0, holderCount: 0 },
    });

    const replay = await app.request(
      '/admin/credentials',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Swift Water Rescue',
          fy_points_default: 0,
          reason: 'Catalog review approved this credential.',
        }),
      },
      mkEnv(sqlite),
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      replayed: true,
      credential: createBody.credential,
    });

    const updated = await app.request(
      `/admin/credentials/${createBody.credential.id}`,
      {
        method: 'PATCH',
        headers: { ...headers, 'Idempotency-Key': 'credential-update-001' },
        body: JSON.stringify({
          name: 'Swift Water Rescue Technician',
          fy_points_default: 4,
          expected_revision: 0,
          reason: 'Catalog title and default points corrected.',
        }),
      },
      mkEnv(sqlite),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      replayed: false,
      credential: {
        id: createBody.credential.id,
        name: 'Swift Water Rescue Technician',
        fyPointsDefault: 4,
      },
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 2 });
  });

  it('lists holder counts and exposes member history links without treating a legacy reference as lifecycle proof', async () => {
    const { app, sqlite } = makeApp();
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    sqlite
      .prepare('INSERT INTO credentials (id, name, fy_points_default) VALUES (41, ?, 3)')
      .run('Hazmat Technician');
    sqlite
      .prepare(
        `INSERT INTO members
          (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, created_at, updated_at)
         VALUES (9, 'SYNTH-009', 'Avery', 'Operator', 'FF', 'FF', 9, 1, 1)`,
      )
      .run();
    sqlite
      .prepare('INSERT INTO member_credentials (member_id, credential_id) VALUES (9, 41)')
      .run();

    const list = await app.request(
      '/admin/credentials',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      credentials: [expect.objectContaining({ id: 41, name: 'Hazmat Technician', holderCount: 1 })],
    });

    const holders = await app.request(
      '/admin/credentials/41/holders',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(sqlite),
    );
    expect(holders.status).toBe(200);
    expect(await holders.json()).toEqual({
      credential: { id: 41, name: 'Hazmat Technician', fyPointsDefault: 3 },
      holders: [
        {
          memberId: 9,
          employeeId: 'SYNTH-009',
          firstName: 'Avery',
          lastName: 'Operator',
          historyHref: '/admin/personnel/qualifications?memberId=9',
          legacyReference: true,
        },
      ],
      lifecycleNotice:
        'Legacy credential references do not establish current qualification status.',
    });
  });
});

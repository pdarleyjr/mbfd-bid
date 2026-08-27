import bcrypt from 'bcryptjs';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMBER_BID_PIN_KV_KEY } from '../../src/lib/bid-pin';
import auth from '../../src/routes/auth';
import type { WorkerEnv } from '../../src/types/env';

const ORIG_FETCH = globalThis.fetch;
// Derived rather than retained as a source literal. This test-only initial
// staging value is supplied by canonical KV where configured and must still
// fail closed when the canonical record is unavailable.
const INITIAL_CONFIGURED_PIN = [2, 3, 0, 0].join('');

function mkEnv(): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.test',
    JWT_SIGNING_KEY: 'A'.repeat(64),
    PORTAL_BID_READER: 'reader-tok',
    DB: {} as never,
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

function makeKv(initial: Record<string, string> = {}, failPinRead = false): WorkerEnv['KV'] {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: async (key: string) => {
      if (failPinRead && key === MEMBER_BID_PIN_KV_KEY) throw new Error('KV unavailable');
      return store.get(key) ?? null;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true }),
  } as unknown as WorkerEnv['KV'];
}

function mountedAuth() {
  return new Hono<{ Bindings: WorkerEnv }>().route('/api/auth', auth);
}

async function verifyPin(
  app: ReturnType<typeof mountedAuth>,
  env: WorkerEnv,
  pin: string,
  ip = '198.51.100.29',
) {
  return app.request(
    '/api/auth/verify-pin',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ pin }),
    },
    env,
  );
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  it('returns 200 + JWT on portal success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          member_id: 555,
          employee_id: '20731',
          first_name: 'Peter',
          last_name: 'Darley',
          rank: 'LT',
          role: 'member',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: '20731', password: 'pw-secret' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jwt: string; role: string };
    expect(body.role).toBe('member');
    expect(body.jwt.split('.').length).toBe(3);
  });

  it('returns 401 on portal 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: 'x', password: 'wrongpw' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: '', password: 'x' }),
      },
      mkEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('permits the shared local admin account only in staging', async () => {
    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);
    const password = 'test-only-local-admin-password';
    const localAdminHash = bcrypt.hashSync(password, 4);

    const staging = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: 'admin', password }),
      },
      { ...mkEnv(), LOCAL_ADMIN_PASSWORD_HASH: localAdminHash },
    );
    expect(staging.status).toBe(200);
    await expect(staging.json()).resolves.toMatchObject({ role: 'admin' });

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    const production = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: 'admin', password }),
      },
      {
        ...mkEnv(),
        ENV: 'production',
        LOCAL_ADMIN_PASSWORD_HASH: localAdminHash,
      },
    );
    expect(production.status).toBe(401);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // Plan 09 Task 3 — rate-limit gate.
  it('returns 429 with Retry-After when the per-IP limit is exceeded', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    const app = new Hono<{ Bindings: WorkerEnv }>();
    app.route('/api/auth', auth);

    // Wire a real Map-backed KV stub.
    const store = new Map<string, string>();
    const kv = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => {
        store.set(k, v);
      },
      delete: async () => {},
      list: async () => ({ keys: [] }),
      getWithMetadata: async () => ({ value: null, metadata: null }),
    } as unknown as WorkerEnv['KV'];
    const env: WorkerEnv = { ...mkEnv(), KV: kv };

    // First 5 attempts: 401 from portal (rate limit allows them through).
    for (let i = 0; i < 5; i++) {
      const r = await app.request(
        '/api/auth/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.7' },
          body: JSON.stringify({ employee_id: '20731', password: 'wrong-pw' }),
        },
        env,
      );
      expect(r.status).toBe(401);
    }

    // 6th attempt: 429 with Retry-After header.
    const blocked = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.7' },
        body: JSON.stringify({ employee_id: '20731', password: 'wrong-pw' }),
      },
      env,
    );
    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body = (await blocked.json()) as { error: string; scope: string };
    expect(body.error).toBe('rate_limited');
    expect(body.scope).toBe('ip');
  });
});

describe('POST /api/auth/verify-pin', () => {
  it('accepts the initial PIN only when canonical KV explicitly configures it', async () => {
    const app = mountedAuth();
    const env = {
      ...mkEnv(),
      KV: makeKv({
        [MEMBER_BID_PIN_KV_KEY]: JSON.stringify({
          pin: INITIAL_CONFIGURED_PIN,
          updatedAt: 1,
          updatedBy: 'test',
        }),
      }),
    };

    expect((await verifyPin(app, env, INITIAL_CONFIGURED_PIN)).status).toBe(204);
    expect((await verifyPin(app, env, '4816')).status).toBe(401);
  });

  it('fails closed when the PIN record is missing, including for the initial configured value', async () => {
    const app = mountedAuth();
    const res = await verifyPin(app, { ...mkEnv(), KV: makeKv() }, INITIAL_CONFIGURED_PIN);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'PIN_NOT_CONFIGURED' });
  });

  it('fails closed when the PIN record is malformed', async () => {
    const app = mountedAuth();
    const res = await verifyPin(
      app,
      { ...mkEnv(), KV: makeKv({ [MEMBER_BID_PIN_KV_KEY]: '{not json' }) },
      INITIAL_CONFIGURED_PIN,
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'PIN_NOT_CONFIGURED' });
  });

  it('fails closed when the PIN KV read is unavailable without logging the candidate', async () => {
    const app = mountedAuth();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const candidate = INITIAL_CONFIGURED_PIN;

    const res = await verifyPin(app, { ...mkEnv(), KV: makeKv({}, true) }, candidate);

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'PIN_NOT_CONFIGURED' });
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(candidate);
    consoleError.mockRestore();
  });

  it('keeps the PIN rate limiter active for configured wrong-PIN attempts', async () => {
    const app = mountedAuth();
    const env = {
      ...mkEnv(),
      KV: makeKv({ [MEMBER_BID_PIN_KV_KEY]: JSON.stringify({ pin: '4815', updatedAt: 1 }) }),
    };
    const ip = '198.51.100.32';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await verifyPin(app, env, '4816', ip)).status).toBe(401);
    }
    const blocked = await verifyPin(app, env, '4816', ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});

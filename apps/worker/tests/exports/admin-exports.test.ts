import type { R2Bucket } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { signJwt } from '../../src/lib/jwt.js';
import adminExports from '../../src/routes/admin/exports.js';
import type { WorkerEnv } from '../../src/types/env.js';

function inMemR2(): R2Bucket & { _objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    _objects: objects,
    async put(key: string, body: string | ArrayBuffer | Uint8Array) {
      const bytes =
        typeof body === 'string'
          ? new TextEncoder().encode(body)
          : body instanceof Uint8Array
            ? body
            : new Uint8Array(body);
      objects.set(key, bytes);
    },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      return {
        objects: keys.map((key) => ({
          key,
          size: (objects.get(key) as Uint8Array).byteLength,
          uploaded: new Date(0),
        })),
      };
    },
  } as unknown as R2Bucket & { _objects: Map<string, Uint8Array> };
}

function makeEnv(r2: R2Bucket): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'a'.repeat(64),
    PIN_HASH: 'x',
    PORTAL_BID_READER: 'tok',
    CF_AI_GATEWAY_URL: 'https://gateway.example.com/v1/x/mbfd-bid/anthropic',
    ANTHROPIC_API_KEY: 'sk-test',
    AI_BUDGET_CAP_CENTS: 2500,
    AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
    AI_KV: {} as never,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: r2,
    PORTAL_QUEUE: {} as never,
    AI: {} as never,
    BROWSER: {} as never,
  };
}

async function adminJwt(env: WorkerEnv): Promise<string> {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: 0,
    emp: 'admin',
    role: 'admin',
    rank: 'CHIEF',
    first_name: 'A',
    last_name: 'B',
    fresh_auth_at: Math.floor(Date.now() / 1000),
  };
  return signJwt(payload, env.JWT_SIGNING_KEY);
}

function mkApp() {
  return new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/exports', adminExports);
}

describe('/api/admin/exports (Plan 08 Task 17)', () => {
  let env: WorkerEnv;
  let r2: ReturnType<typeof inMemR2>;
  beforeEach(() => {
    r2 = inMemR2();
    env = makeEnv(r2);
  });

  it('POST /print-token requires admin', async () => {
    const res = await mkApp().request('/api/admin/exports/print-token', { method: 'POST' }, env);
    expect(res.status).toBe(401);
  });

  it('POST /print-token mints a token with the right format', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/exports/print-token',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'roster', shift: 'A', session_id: '01HF3' }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]+$/);
  });

  it('POST /print-token rejects malformed body', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/exports/print-token',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'bogus' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('POST /roster/Z returns 400 invalid_shift', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/exports/roster/Z',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: '01HF3' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('POST /roster/A returns 503 when BROWSER binding is absent', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/exports/roster/A',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: '01HF3' }),
      },
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('browser_rendering_not_configured');
  });

  it('GET /:session_id lists exports under the year/session prefix', async () => {
    const year = new Date().getUTCFullYear();
    r2._objects.set(`${year}/01HF3/A_Shift_1.pdf`, new Uint8Array([0x25]));
    r2._objects.set(`${year}/01HF3/audit_full_2.csv.gz`, new Uint8Array([0x1f, 0x8b]));
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/exports/01HF3',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      exports: Array<{ r2Key: string; kind: string }>;
    };
    expect(body.exports).toHaveLength(2);
    expect(body.exports.find((e) => e.kind === 'roster-pdf')).toBeDefined();
    expect(body.exports.find((e) => e.kind === 'audit-csv')).toBeDefined();
  });

  it('GET /:session_id/:r2key/url returns 503 when R2 access keys are absent', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/exports/01HF3/somekey/url',
      { headers: { Authorization: `Bearer ${jwt}` } },
      env,
    );
    expect(res.status).toBe(503);
  });
});

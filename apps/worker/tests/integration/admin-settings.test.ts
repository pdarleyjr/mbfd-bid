import type { KVNamespace } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import adminSettings from '../../src/routes/admin/settings.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

async function adminJwt(env: { JWT_SIGNING_KEY: string }): Promise<string> {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: 0,
    emp: 'admin',
    role: 'admin',
    rank: 'CHIEF',
    first_name: 'Bid',
    last_name: 'Admin',
    fresh_auth_at: Math.floor(Date.now() / 1000),
  };
  return signJwt(payload, env.JWT_SIGNING_KEY);
}

describe('/api/admin/settings/bid-pin', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    h.env.KV = makeKv();
  });

  afterEach(() => teardownTestD1(h));

  function app() {
    return new Hono<{ Bindings: typeof h.env }>().route('/api/admin/settings', adminSettings);
  }

  it('returns an explicit unconfigured state for an authenticated admin', async () => {
    const jwt = await adminJwt(h.env);
    const res = await app().request(
      '/api/admin/settings/bid-pin',
      { headers: { Authorization: `Bearer ${jwt}` } },
      h.env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ configured: false, state: 'missing' });
  });

  it('allows an authenticated admin to initialize a missing PIN record', async () => {
    const jwt = await adminJwt(h.env);
    const api = app();
    const put = await api.request(
      '/api/admin/settings/bid-pin',
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '4815' }),
      },
      h.env,
    );

    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toMatchObject({ configured: true, pin: '4815' });

    const get = await api.request(
      '/api/admin/settings/bid-pin',
      { headers: { Authorization: `Bearer ${jwt}` } },
      h.env,
    );
    await expect(get.json()).resolves.toMatchObject({ configured: true, pin: '4815' });
  });
});

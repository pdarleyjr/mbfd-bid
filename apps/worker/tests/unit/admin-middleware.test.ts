import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import { requireAdmin } from '../../src/routes/admin/middleware.js';
import type { WorkerEnv } from '../../src/types/env';

const KEY = 'a'.repeat(64);

function mkEnv(): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: KEY,
    PIN_HASH: '$2b$12$placeholder',
    PORTAL_BID_READER: 'tok',
    DB: {} as never,
    KV: {} as never,
  };
}

const BASE_PAYLOAD = {
  sub: 1,
  emp: '14335',
  rank: 'FF' as const,
  first_name: 'Test',
  last_name: 'User',
  fresh_auth_at: Math.floor(Date.now() / 1000),
};

function makeApp() {
  const app = new Hono<{ Bindings: WorkerEnv }>();
  app.use('*', requireAdmin);
  app.get('/protected', (c) => c.text('ok'));
  return app;
}

describe('requireAdmin middleware', () => {
  it('returns 401 when no Authorization header', async () => {
    const res = await makeApp().request('/protected', {}, mkEnv());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringMatching(/missing_auth|invalid_token/) });
  });

  it('returns 401 when Authorization is malformed (no Bearer prefix)', async () => {
    const res = await makeApp().request(
      '/protected',
      { headers: { Authorization: 'NotBearer xyz' } },
      mkEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when JWT verify fails', async () => {
    const res = await makeApp().request(
      '/protected',
      { headers: { Authorization: 'Bearer not-a-real-jwt' } },
      mkEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for role=member', async () => {
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'member' }, KEY);
    const res = await makeApp().request(
      '/protected',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'forbidden' });
  });

  it('passes through for role=admin', async () => {
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await makeApp().request(
      '/protected',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('exposes claims to downstream handler via c.get("claims")', async () => {
    const app = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
    app.use('*', requireAdmin);
    app.get('/me', (c) => {
      const claims = c.get('claims');
      return c.json({ emp: claims.emp, role: claims.role });
    });
    const jwt = await signJwt({ ...BASE_PAYLOAD, role: 'admin' }, KEY);
    const res = await app.request('/me', { headers: { Authorization: `Bearer ${jwt}` } }, mkEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ emp: '14335', role: 'admin' });
  });
});

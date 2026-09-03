import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import { requireAdmin } from '../../src/routes/admin/middleware.js';
import type { WorkerEnv } from '../../src/types/env';

const KEY = 'a'.repeat(64);

function memberLookupDb(rows: Record<string, number> = {}): D1Database {
  return {
    prepare: () => ({
      bind: (employeeId: string) => ({
        first: async () => {
          const id = rows[employeeId];
          return id === undefined ? null : { id };
        },
      }),
    }),
  } as unknown as D1Database;
}

function mkEnv(memberRows: Record<string, number> = {}): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: KEY,
    PORTAL_BID_READER: 'tok',
    DB: memberLookupDb(memberRows),
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

  it('maps an admin to the local Bid member by exact employee ID', async () => {
    const app = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
    app.use('*', requireAdmin);
    app.get('/me', (c) => c.json({ memberId: c.get('claims').member_id }));
    const jwt = await signJwt({ ...BASE_PAYLOAD, sub: 67, member_id: 67, role: 'admin' }, KEY);

    const res = await app.request(
      '/me',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv({ '14335': 64 }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ memberId: 64 });
  });

  it('does not infer a local Bid member when the exact employee ID is absent', async () => {
    const app = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
    app.use('*', requireAdmin);
    app.get('/me', (c) => c.json({ memberId: c.get('claims').member_id }));
    const jwt = await signJwt({ ...BASE_PAYLOAD, sub: 67, member_id: 67, role: 'admin' }, KEY);

    const res = await app.request(
      '/me',
      { headers: { Authorization: `Bearer ${jwt}` } },
      mkEnv({ unrelated: 64 }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ memberId: 67 });
  });
});

import { BID_SESSION_MAX_AGE_SEC } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signJwt, verifyJwt } from '../../src/lib/jwt.js';
import { STEP_UP_MAX_AGE_SEC, isStepUpFresh } from '../../src/lib/step-up-auth.js';
import { requireStepUpAuth } from '../../src/middleware/require-step-up.js';
import { requireAdmin } from '../../src/routes/admin/middleware.js';
import type { WorkerEnv } from '../../src/types/env.js';

const KEY = 'a'.repeat(64);

const authEnv = {
  JWT_SIGNING_KEY: KEY,
  PORTAL_BASE_URL: 'https://portal.example',
  DB: {
    prepare: () => ({
      bind: (employeeId: string) => ({
        first: async () => (employeeId === 'admin' ? { id: 1 } : null),
      }),
    }),
  },
} as unknown as WorkerEnv;

async function mintAdminJwt(freshAuthAt: number): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Bid',
      last_name: 'Admin',
      fresh_auth_at: freshAuthAt,
    },
    KEY,
  );
}

describe('isStepUpFresh', () => {
  it('returns true when fresh_auth_at is within the window', () => {
    const now = 1_700_000_000;
    expect(isStepUpFresh(now - 100, now)).toBe(true);
  });

  it('returns false when fresh_auth_at is exactly at the limit', () => {
    const now = 1_700_000_000;
    expect(isStepUpFresh(now - STEP_UP_MAX_AGE_SEC, now)).toBe(false);
  });

  it('returns false when fresh_auth_at is older than the window', () => {
    const now = 1_700_000_000;
    expect(isStepUpFresh(now - STEP_UP_MAX_AGE_SEC - 1, now)).toBe(false);
  });

  it('returns false when fresh_auth_at is in the future', () => {
    const now = 1_700_000_000;
    expect(isStepUpFresh(now + 1, now)).toBe(false);
  });

  it('STEP_UP_MAX_AGE_SEC is exactly 300', () => {
    expect(STEP_UP_MAX_AGE_SEC).toBe(300);
  });
});

describe('requireStepUpAuth middleware', () => {
  it('returns 401 step_up_required when claims are too old', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const staleJwt = await mintAdminJwt(nowSec - 600);

    const app = new Hono<{ Bindings: { JWT_SIGNING_KEY: string } }>()
      .use('*', requireAdmin)
      .use('*', requireStepUpAuth())
      .get('/x', (c) => c.text('ok'));

    const res = await app.request(
      '/x',
      { headers: { Authorization: `Bearer ${staleJwt}` } },
      authEnv,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('step_up_required');
  });

  it('passes through when fresh_auth_at is recent', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const freshJwt = await mintAdminJwt(nowSec - 30);

    const app = new Hono<{ Bindings: { JWT_SIGNING_KEY: string } }>()
      .use('*', requireAdmin)
      .use('*', requireStepUpAuth())
      .get('/x', (c) => c.text('ok'));

    const res = await app.request(
      '/x',
      { headers: { Authorization: `Bearer ${freshJwt}` } },
      authEnv,
    );
    expect(res.status).toBe(200);
  });

  it('returns 403 if requireAdmin has not run (claims missing)', async () => {
    const app = new Hono().use('*', requireStepUpAuth()).get('/x', (c) => c.text('ok'));
    const res = await app.request('/x');
    expect(res.status).toBe(403);
  });
});

describe('long-lived Hub-verified operator session', () => {
  afterEach(() => vi.unstubAllGlobals());

  const hubIdentity = {
    issuer: 'https://www.mbfdhub.com',
    audience: 'bid',
    hub_user_id: 901,
    member_id: 1,
    employee_id: 'admin',
    security_version: 3,
    first_name: 'Synthetic',
    last_name: 'Admin',
    rank: 'CHIEF',
    role: 'admin',
  };
  async function command(hubResponse: Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => hubResponse.clone()),
    );
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt(
      {
        sub: 901,
        hub_user_id: 901,
        member_id: 1,
        emp: 'admin',
        security_version: 3,
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: now - 600,
        authz_checked_at: now - 600,
      },
      KEY,
      '8h',
    );
    const app = new Hono<{ Bindings: WorkerEnv }>()
      .use('*', requireAdmin)
      .use('*', requireStepUpAuth())
      .post('/command', (c) => c.text('executed'));
    return app.request(
      '/command',
      { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } },
      {
        ...authEnv,
        PORTAL_BASE_URL: 'https://www.mbfdhub.com',
        PORTAL_BID_FEDERATION_TOKEN: 'synthetic-federation-token',
      },
    );
  }

  it('allows a deliberate write after five minutes only after Hub revalidates the same admin', async () => {
    const response = await command(Response.json(hubIdentity));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('executed');
    expect(fetch).toHaveBeenCalledOnce();
    const refreshed = response.headers.get('X-MBFD-Session-Refresh');
    expect(refreshed).not.toBeNull();
    const claims = await verifyJwt(refreshed ?? '', KEY);
    expect(claims.authz_checked_at - claims.fresh_auth_at).toBeGreaterThanOrEqual(600);
    expect(claims.exp - claims.iat).toBe(BID_SESSION_MAX_AGE_SEC);
  });

  it.each([
    [Response.json({}, { status: 401 }), 401],
    [Response.json({}, { status: 503 }), 503],
    [Response.json({ ...hubIdentity, role: 'member' }), 403],
    [Response.json({ ...hubIdentity, security_version: 4 }), 401],
    [Response.json({ ...hubIdentity, member_id: 2 }), 401],
  ])(
    'rejects revoked, unavailable, downgraded, or changed Hub authority',
    async (hubResponse, expected) => {
      expect((await command(hubResponse)).status).toBe(expected);
    },
  );
});

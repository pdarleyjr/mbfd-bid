import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import { STEP_UP_MAX_AGE_SEC, isStepUpFresh } from '../../src/lib/step-up-auth.js';
import { requireStepUpAuth } from '../../src/middleware/require-step-up.js';
import { requireAdmin } from '../../src/routes/admin/middleware.js';

const KEY = 'a'.repeat(64);

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
      { JWT_SIGNING_KEY: KEY },
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
      { JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
  });

  it('returns 403 if requireAdmin has not run (claims missing)', async () => {
    const app = new Hono().use('*', requireStepUpAuth()).get('/x', (c) => c.text('ok'));
    const res = await app.request('/x');
    expect(res.status).toBe(403);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 's'.repeat(64);

async function staleAdminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Bid',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000) - 600,
    },
    KEY,
  );
}

describe('admin write routes require fresh step-up auth', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    const now = Date.now();
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (1, 'EMP1', 'Edit', 'Me', 'FF', 'FF', 50, 0, ?, ?);",
      [now, now],
    );
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it.each([
    [
      'legacy skip',
      new Request('http://x/api/admin/bid/skip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
        },
        body: JSON.stringify({ bidSessionId: '01HSESS', reason: 'stale token check' }),
      }),
    ],
    [
      'member patch',
      new Request('http://x/api/admin/members/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rank: 'LT' }),
      }),
    ],
    [
      'position clone',
      new Request('http://x/api/admin/positions/clone-from-year/2026.1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destVersion: '2027.1', destYear: 2027 }),
      }),
    ],
  ])('%s returns step_up_required for stale admin JWT', async (_name, request) => {
    request.headers.set('Authorization', `Bearer ${await staleAdminJwt()}`);
    const res = await app.fetch(request, { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('step_up_required');
  });
});

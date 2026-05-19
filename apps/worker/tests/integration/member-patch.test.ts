import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'l'.repeat(64);
async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'B',
      last_name: 'A',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('PATCH /api/admin/members/:id', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    const now = Date.now();
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (1, 'EMP1', 'Edit', 'Me', 'FF', 'FF', 50, 0, ?, ?);",
      [now, now],
    );
    await h.db.run(
      "INSERT INTO credentials (id, name) VALUES (1, 'Paramedic'), (2, 'Driver Engineer Qualified');",
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('updates rank and writes audit before/after', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/1', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rank: 'LT' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run('SELECT rank FROM members WHERE id = 1');
    expect(rows.results[0]?.rank).toBe('LT');

    const audit = await h.db.run(
      "SELECT before_state, after_state FROM audit_log WHERE action = 'override_cert' ORDER BY seq DESC LIMIT 1",
    );
    const a = audit.results[0] as { before_state: string; after_state: string } | undefined;
    expect(a?.before_state).toMatch(/"rank":"FF"/);
    expect(a?.after_state).toMatch(/"rank":"LT"/);
  });

  it('replaces the credentials set (by name) when credentials array is provided', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/1', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credentials: ['Paramedic'] }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const after = await h.db.run(
      'SELECT count(*) AS n FROM member_credentials WHERE member_id = 1',
    );
    expect(after.results[0]?.n).toBe(1);
  });

  it('rejects unknown credential name with 400', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/1', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ credentials: ['Unicorn License'] }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown member id', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/999', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rank: 'LT' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(404);
  });
});

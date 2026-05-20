import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'd'.repeat(64);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Seed',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

interface SeedResponse {
  membersProcessed: number;
  certsInserted: number;
  missingMembers: string[];
  missingCredentials: string[];
}

describe('POST /api/admin/members/seed-from-synthesis', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    const now = Date.now();
    await h.db.run(
      `INSERT INTO members
        (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, rank_seniority, is_probationary, created_at, updated_at)
       VALUES
        (1, '14335', 'Jesus', 'Sola', 'CPT', 'OFC', 4, 4, 0, ?, ?),
        (2, '20001', 'John', 'Smith', 'FF', 'FF', 7, NULL, 0, ?, ?);`,
      [now, now, now, now],
    );
    await h.db.run(
      "INSERT INTO credentials (id, name) VALUES (1, 'Paramedic'), (2, 'Driver Engineer Qualified');",
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('happy path — inserts certs for known members and reports counts', async () => {
    const payload = [
      { employee_id: 14335, inferred_certs_2025: ['Paramedic', 'Driver Engineer Qualified'] },
      { employee_id: 20001, inferred_certs_2025: ['Paramedic'] },
      { employee_id: 14335, inferred_certs_2025: [] }, // empty row should skip silently
    ];
    const res = await app.fetch(
      new Request('http://x/api/admin/members/seed-from-synthesis', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SeedResponse;
    expect(body.membersProcessed).toBe(2);
    expect(body.certsInserted).toBe(3);
    expect(body.missingMembers).toEqual([]);

    const rows = await h.db.run('SELECT count(*) AS n FROM member_credentials');
    expect(rows.results[0]?.n).toBe(3);
  });

  it('reports missing members and missing credentials separately', async () => {
    const payload = [
      { employee_id: 'NOT_A_MEMBER', inferred_certs_2025: ['Paramedic'] },
      { employee_id: 14335, inferred_certs_2025: ['Mystery Cert That Does Not Exist'] },
    ];
    const res = await app.fetch(
      new Request('http://x/api/admin/members/seed-from-synthesis', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SeedResponse;
    expect(body.missingMembers).toEqual(['NOT_A_MEMBER']);
    expect(body.missingCredentials).toEqual(['Mystery Cert That Does Not Exist']);
    expect(body.certsInserted).toBe(0);
    expect(body.membersProcessed).toBe(1); // employee 14335 was found, even if cert missing
  });

  it('is idempotent — re-running inserts zero new rows', async () => {
    const payload = [{ employee_id: 14335, inferred_certs_2025: ['Paramedic'] }];
    const req1 = new Request('http://x/api/admin/members/seed-from-synthesis', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const res1 = await app.fetch(req1, { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as SeedResponse;
    expect(body1.certsInserted).toBe(1);

    const req2 = new Request('http://x/api/admin/members/seed-from-synthesis', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const res2 = await app.fetch(req2, { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as SeedResponse;
    expect(body2.certsInserted).toBe(0); // already there
  });

  it('rejects non-array payloads with 400', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/seed-from-synthesis', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ not: 'an array' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

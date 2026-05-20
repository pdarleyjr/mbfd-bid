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
  membersInserted: number;
  membersUpdated: number;
  certsInserted: number;
  skippedMembers: Array<{ employee_id: string; reason: string }>;
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

  it('updates known members in place and links inferred certs', async () => {
    const payload = [
      {
        employee_id: 14335,
        first_name: 'Jesus',
        last_name: 'Sola',
        current_rank: 'Captain',
        bid_category: 'OFC',
        bid: 'Include',
        rsc_seniority: 4,
        rank_seniority: 4,
        inferred_certs_2025: ['Paramedic', 'Driver Engineer Qualified'],
      },
      {
        employee_id: 20001,
        first_name: 'John',
        last_name: 'Smith',
        current_rank: 'Firefighter',
        bid_category: 'FF',
        bid: 'Include',
        rsc_seniority: 7,
        inferred_certs_2025: ['Paramedic'],
      },
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
    expect(body.membersInserted).toBe(0);
    expect(body.membersUpdated).toBe(2);
    expect(body.certsInserted).toBe(3);
    expect(body.skippedMembers).toEqual([]);

    const rows = await h.db.run('SELECT count(*) AS n FROM member_credentials');
    expect(rows.results[0]?.n).toBe(3);
  });

  it('inserts missing members (bootstraps a fresh DB)', async () => {
    const payload = [
      {
        employee_id: 99999,
        first_name: 'Brand',
        last_name: 'New',
        current_rank: 'Lieutenant',
        bid_category: 'OFC',
        bid: 'Include',
        rsc_seniority: 42,
        rank_seniority: 42,
        inferred_certs_2025: ['Paramedic'],
      },
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
    expect(body.membersInserted).toBe(1);
    expect(body.membersUpdated).toBe(0);
    expect(body.certsInserted).toBe(1);

    const rows = await h.db.run(
      "SELECT employee_id, rank, rsc_seniority FROM members WHERE employee_id = '99999'",
    );
    expect(rows.results[0]).toMatchObject({
      employee_id: '99999',
      rank: 'LT',
      rsc_seniority: 42,
    });
  });

  it('skips members with bid=Exclude or missing seniority/name', async () => {
    const payload = [
      {
        employee_id: 30001,
        first_name: 'Should',
        last_name: 'Skip',
        current_rank: 'Firefighter',
        bid: 'Exclude',
        rsc_seniority: 1,
        inferred_certs_2025: [],
      },
      {
        employee_id: 30002,
        first_name: 'No',
        last_name: 'Seniority',
        current_rank: 'Firefighter',
        bid: 'Include',
        rsc_seniority: null,
        inferred_certs_2025: [],
      },
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
    expect(body.membersInserted).toBe(0);
    expect(body.skippedMembers).toHaveLength(2);
    expect(body.skippedMembers.map((s) => s.reason).sort()).toEqual([
      'bid=Exclude',
      'missing_rsc_seniority',
    ]);
  });

  it('reports missing credentials separately without skipping the member', async () => {
    const payload = [
      {
        employee_id: 14335,
        first_name: 'Jesus',
        last_name: 'Sola',
        current_rank: 'Captain',
        bid_category: 'OFC',
        bid: 'Include',
        rsc_seniority: 4,
        rank_seniority: 4,
        inferred_certs_2025: ['Mystery Cert That Does Not Exist'],
      },
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
    expect(body.missingCredentials).toEqual(['Mystery Cert That Does Not Exist']);
    expect(body.certsInserted).toBe(0);
    expect(body.membersUpdated).toBe(1);
  });

  it('is idempotent — re-running inserts zero new rows', async () => {
    const payload = [
      {
        employee_id: 14335,
        first_name: 'Jesus',
        last_name: 'Sola',
        current_rank: 'Captain',
        bid_category: 'OFC',
        bid: 'Include',
        rsc_seniority: 4,
        rank_seniority: 4,
        inferred_certs_2025: ['Paramedic'],
      },
    ];
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
    expect(body2.certsInserted).toBe(0);
    expect(body2.membersInserted).toBe(0);
    expect(body2.membersUpdated).toBe(1);
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

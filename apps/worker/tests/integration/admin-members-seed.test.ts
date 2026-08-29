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

async function memberWriteState(h: TestD1) {
  const [members, credentials, assignments, lifecycleEvents, audit] = await Promise.all([
    h.db.run('SELECT * FROM members ORDER BY id'),
    h.db.run('SELECT * FROM member_credentials ORDER BY member_id, credential_id'),
    h.db.run('SELECT * FROM member_assignments ORDER BY id'),
    h.db.run('SELECT * FROM personnel_lifecycle_events ORDER BY id'),
    h.db.run('SELECT * FROM audit_log ORDER BY id'),
  ]);
  return {
    members: members.results,
    credentials: credentials.results,
    assignments: assignments.results,
    lifecycleEvents: lifecycleEvents.results,
    audit: audit.results,
  };
}

async function expectRetiredSynthesisSeed(
  h: TestD1,
  before: Awaited<ReturnType<typeof memberWriteState>>,
  res: Response,
) {
  expect(res.status).toBe(410);
  await expect(res.json()).resolves.toMatchObject({
    error: 'legacy_member_write_retired',
    operation: 'synthesis_seed',
    operator_workflows: {
      telestaff: {
        ui: '/admin/telestaff',
        api: '/api/admin/telestaff/imports',
      },
    },
  });
  expect(await memberWriteState(h)).toEqual(before);
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
      `INSERT INTO credentials (id, name) VALUES
        (1, 'Paramedic'),
        (2, 'Driver Engineer Qualified'),
        (3, 'Hazardous Materials Operations'),
        (4, 'Rope Rescue Operations'),
        (5, 'Confined Space Operations'),
        (6, 'Structural Collapse Operations'),
        (7, 'Trench Rescue Operations'),
        (8, 'Vehicle & Machinery Rescue Operations');`,
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('retires legacy synthesis updates without mutating current projections', async () => {
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
    const before = await memberWriteState(h);
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
    await expectRetiredSynthesisSeed(h, before, res);
  });

  it('retires legacy synthesis bootstraps without creating a member', async () => {
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
    const before = await memberWriteState(h);
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
    await expectRetiredSynthesisSeed(h, before, res);
  });

  it('retires invalid legacy synthesis payloads before they can mutate state', async () => {
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
    const before = await memberWriteState(h);
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
    await expectRetiredSynthesisSeed(h, before, res);
  });

  it('retires unresolved credential synthesis without mutating credentials', async () => {
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
    const before = await memberWriteState(h);
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
    await expectRetiredSynthesisSeed(h, before, res);
  });

  it('remains retired when the same legacy synthesis request is retried', async () => {
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
    const before = await memberWriteState(h);
    const req1 = new Request('http://x/api/admin/members/seed-from-synthesis', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const res1 = await app.fetch(req1, { ...h.env, JWT_SIGNING_KEY: KEY });
    await expectRetiredSynthesisSeed(h, before, res1);

    const req2 = new Request('http://x/api/admin/members/seed-from-synthesis', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const res2 = await app.fetch(req2, { ...h.env, JWT_SIGNING_KEY: KEY });
    await expectRetiredSynthesisSeed(h, before, res2);
  });

  it('retires legacy specialty derivation without changing member credentials', async () => {
    // Two LT/CPT members; one held a TRT slot, the other a non-TRT slot.
    // The TRT row has no explicit inferred_certs_2025 — derivation must come
    // from position_2025.
    const payload = [
      {
        employee_id: 18912,
        first_name: 'Steven',
        last_name: 'Vasquez',
        current_rank: 'Captain',
        bid_category: 'OFC',
        bid: 'Include',
        rsc_seniority: 50,
        rank_seniority: 5,
        inferred_certs_2025: [],
        position_2025: 'A201',
      },
      {
        employee_id: 20001,
        first_name: 'John',
        last_name: 'Smith',
        current_rank: 'Firefighter',
        bid_category: 'FF',
        bid: 'Include',
        rsc_seniority: 7,
        inferred_certs_2025: [],
        position_2025: 'A102',
      },
    ];
    const before = await memberWriteState(h);
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
    await expectRetiredSynthesisSeed(h, before, res);
  });

  it('retires malformed legacy synthesis input before parsing it', async () => {
    const before = await memberWriteState(h);
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
    await expectRetiredSynthesisSeed(h, before, res);
  });

  it('retires wrapped legacy synthesis input without changing member records', async () => {
    // Sends the new shape — `credentials[]` instead of `inferred_certs_2025[]`,
    // `straight_seniority` instead of `rsc_seniority`, `rank` instead of
    // `current_rank`, top-level wrapper instead of bare array.
    const payload = {
      members: [
        {
          employee_id: 14335,
          first_name: 'Jesus',
          last_name: 'Sola',
          rank: 'Captain',
          straight_seniority: 4,
          rank_seniority: 4,
          credentials: ['Paramedic', 'Driver Engineer Qualified'],
        },
      ],
      unmatched_credentials: ['Some Cert The Reference Doesnt Know'],
    };
    const before = await memberWriteState(h);
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
    await expectRetiredSynthesisSeed(h, before, res);
  });
});

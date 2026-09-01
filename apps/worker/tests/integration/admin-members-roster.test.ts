import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'r'.repeat(64);

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

async function expectRetiredCredentialChange(
  h: TestD1,
  before: Awaited<ReturnType<typeof memberWriteState>>,
  res: Response,
) {
  expect(res.status).toBe(410);
  await expect(res.json()).resolves.toMatchObject({
    error: 'legacy_member_write_retired',
    operation: 'credential_change',
    credential_lifecycle: {
      status: 'configured',
      api: '/api/admin/qualification-lifecycle/events',
    },
    operator_workflows: {
      personnel: { ui: '/admin/personnel', api: '/api/admin/personnel/changes' },
      telestaff: { ui: '/admin/telestaff', api: '/api/admin/telestaff/imports' },
    },
  });
  expect(await memberWriteState(h)).toEqual(before);
}

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Roster',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

interface RosterResponse {
  members: {
    id: number;
    employee_id: string;
    last_name: string;
    rank: string;
    ordinal: number;
    manual_override_ordinal: number | null;
    credential_ids: number[];
  }[];
  total: number;
}

describe('GET /api/admin/members/roster', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    const now = Date.now();
    // Seed three members: one OFC captain, two FF.
    await h.db.run(
      `INSERT INTO members
        (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, rank_seniority, is_probationary, created_at, updated_at)
       VALUES
        (1, '14335', 'Jesus', 'Sola', 'CPT', 'OFC', 4, 4, 0, ?, ?),
        (2, '20001', 'John', 'Smith', 'FF', 'FF', 7, NULL, 0, ?, ?),
        (3, '20002', 'Jane', 'Doe', 'FF', 'FF', 9, NULL, 0, ?, ?);`,
      [now, now, now, now, now, now],
    );
    // Seed two credentials including Driver Engineer Qualified.
    await h.db.run(
      "INSERT INTO credentials (id, name) VALUES (1, 'Paramedic'), (2, 'Driver Engineer Qualified');",
    );
    // Member 3 holds DE.
    await h.db.run('INSERT INTO member_credentials (member_id, credential_id) VALUES (3, 2);');
    // Seed a bid year + session for override tests.
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES ('S1', 2026, ?, 'config', 180, 2, 0);",
      [now],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns 401 without auth', async () => {
    const res = await app.fetch(new Request('http://x/api/admin/members/roster'), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(res.status).toBe(401);
  });

  it('returns members in pool-then-seniority order (OFC first, then FF)', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/roster', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterResponse;
    expect(body.total).toBe(3);
    expect(body.members[0]?.employee_id).toBe('14335'); // OFC captain wins
    expect(body.members[0]?.ordinal).toBe(1);
    expect(body.members[1]?.employee_id).toBe('20001'); // FF rsc=7 next
    expect(body.members[2]?.employee_id).toBe('20002'); // FF rsc=9 last
  });

  it('?rank=CPT filter limits results to captains', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/roster?rank=CPT', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterResponse;
    expect(body.total).toBe(1);
    expect(body.members[0]?.rank).toBe('CPT');
  });

  it('?station=de filter returns only members with Driver Engineer Qualified', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/roster?station=de', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterResponse;
    expect(body.total).toBe(1);
    expect(body.members[0]?.employee_id).toBe('20002');
    expect(body.members[0]?.credential_ids).toContain(2);
  });

  it('GET /eligible-for/:station 400s on bad station', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/members/eligible-for/not-a-station', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('PATCH /bid-order persists overrides and they show up in subsequent GET responses', async () => {
    const patchRes = await app.fetch(
      new Request('http://x/api/admin/members/bid-order', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: 'S1',
          overrides: [{ member_id: 3, override_ordinal: 1 }],
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { updated: number };
    expect(patchBody.updated).toBe(1);

    const getRes = await app.fetch(
      new Request('http://x/api/admin/members/roster?session_id=S1', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const getBody = (await getRes.json()) as RosterResponse;
    const m3 = getBody.members.find((m) => m.id === 3);
    expect(m3?.ordinal).toBe(1);
    expect(m3?.manual_override_ordinal).toBe(1);
  });

  it('rolls back a manual bid-order override when its audit receipt fails', async () => {
    // One override statement precedes the required audit statement.
    h.failNextBatchAt(1);
    const response = await app.fetch(
      new Request('http://x/api/admin/members/bid-order', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: 'S1',
          overrides: [{ member_id: 3, override_ordinal: 1 }],
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(500);
    expect(
      (await h.db.run("SELECT COUNT(*) AS n FROM manual_bid_order_override WHERE bid_session_id = 'S1'"))
        .results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run(
          "SELECT COUNT(*) AS n FROM audit_log WHERE target_kind = 'manual_bid_order_override' AND target_id = 'S1'",
        )
      ).results,
    ).toEqual([{ n: 0 }]);
  });

  it('retires direct credential toggles without mutating credentials or audit evidence', async () => {
    const before = await memberWriteState(h);
    const first = await app.fetch(
      new Request('http://x/api/admin/members/1/credentials/2', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    await expectRetiredCredentialChange(h, before, first);

    const second = await app.fetch(
      new Request('http://x/api/admin/members/1/credentials/2', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    await expectRetiredCredentialChange(h, before, second);
  });
});

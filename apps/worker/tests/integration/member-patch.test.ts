import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'l'.repeat(64);

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

async function expectRetiredMemberPatch(
  h: TestD1,
  before: Awaited<ReturnType<typeof memberWriteState>>,
  res: Response,
) {
  expect(res.status).toBe(410);
  await expect(res.json()).resolves.toMatchObject({
    error: 'legacy_member_write_retired',
    operation: 'member_patch',
    operator_workflows: {
      personnel: {
        ui: '/admin/personnel',
        api: '/api/admin/personnel/changes',
      },
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

  it('retires direct rank patches before they can mutate the projection or audit', async () => {
    const before = await memberWriteState(h);
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
    await expectRetiredMemberPatch(h, before, res);
  });

  it('retires direct credential-set patches without changing credentials', async () => {
    const before = await memberWriteState(h);
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
    await expectRetiredMemberPatch(h, before, res);
  });

  it('retires invalid direct credential patches before validation can mutate state', async () => {
    const before = await memberWriteState(h);
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
    await expectRetiredMemberPatch(h, before, res);
  });

  it('retires direct patches even when the member id is unknown', async () => {
    const before = await memberWriteState(h);
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
    await expectRetiredMemberPatch(h, before, res);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'd'.repeat(64);
const CAPTURED_AT = Date.UTC(2026, 7, 27, 12, 0, 0);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Admin',
      last_name: 'Test',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function memberJwt(memberId: number, rank: 'DC' | 'LT' | 'FF'): Promise<string> {
  return signJwt(
    {
      sub: memberId,
      emp: `member-${memberId}`,
      role: 'member',
      rank,
      first_name: 'Member',
      last_name: String(memberId),
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function seedPolicyFixture(
  h: TestD1,
  options: {
    includeChiefAssignments?: boolean;
    bindingReviewStatus?: 'draft' | 'approved';
  } = {},
) {
  const now = CAPTURED_AT;
  const includeChiefAssignments = options.includeChiefAssignments ?? true;
  const bindingReviewStatus = options.bindingReviewStatus ?? 'approved';
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES
       ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter'),
       ('A301', '2026.1', 'A', '3', 'Combat', 'Engine 3', 'LT', 'Lieutenant'),
       ('A211', '2026.1', 'A', '2', 'Combat', '300', 'DC', 'Division Chief'),
       ('B211', '2026.1', 'B', '2', 'Combat', '300', 'DC', 'Division Chief'),
       ('C211', '2026.1', 'C', '2', 'Combat', '300', 'DC', 'Division Chief');`,
  );
  // POL-015 is a rule-book-scoped correction: the designated future book
  // remains a draft during mock rehearsal. The position template is unchanged,
  // so active 2026.1 data is never reinterpreted in place.
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.2', 2026, 'draft');",
  );
  await h.db.run(
    `INSERT INTO rule_book_position_participation
       (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
     VALUES
       ('2026.2', 'A211', '2026.1', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'POL-015-authoritative-direction', ${now}),
       ('2026.2', 'B211', '2026.1', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'POL-015-authoritative-direction', ${now}),
       ('2026.2', 'C211', '2026.1', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'POL-015-authoritative-direction', ${now});`,
  );
  await h.db.run(
    `INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, rank_seniority,
        is_probationary, employment_status, employment_status_effective_on, created_at, updated_at)
     VALUES
       (101, 'member-101', 'Member', '101', 'DC', 'OFC', 1, 1, 0, 'active', '2026-01-01', ${now}, ${now}),
       (102, 'member-102', 'Member', '102', 'DC', 'OFC', 2, 2, 0, 'active', '2026-01-01', ${now}, ${now}),
       (103, 'member-103', 'Member', '103', 'DC', 'OFC', 3, 3, 0, 'active', '2026-01-01', ${now}, ${now}),
       (104, 'member-104', 'Member', '104', 'LT', 'OFC', 4, 4, 0, 'active', '2026-01-01', ${now}, ${now}),
       (105, 'member-105', 'Member', '105', 'FF', 'FF', 5, 5, 0, 'active', '2026-01-01', ${now}, ${now});`,
  );
  await h.db.run(
    `INSERT INTO staffing_positions
       (id, stable_slot_key, active_from, review_status, created_at, updated_at)
     VALUES
       ('staff-A211', 'A211_STAFFING_SLOT', '2026-01-01', 'approved', ${now}, ${now}),
       ('staff-B211', 'B211_STAFFING_SLOT', '2026-01-01', 'approved', ${now}, ${now}),
       ('staff-C211', 'C211_STAFFING_SLOT', '2026-01-01', 'approved', ${now}, ${now});`,
  );
  await h.db.run(
    `INSERT INTO position_staffing_bindings
       (position_id, template_version, staffing_position_id, authoritative_source_ref, review_status, created_at)
     VALUES
       ('A211', '2026.1', 'staff-A211', 'POL-015-authoritative-direction', '${bindingReviewStatus}', ${now}),
       ('B211', '2026.1', 'staff-B211', 'POL-015-authoritative-direction', '${bindingReviewStatus}', ${now}),
       ('C211', '2026.1', 'staff-C211', 'POL-015-authoritative-direction', '${bindingReviewStatus}', ${now});`,
  );
  if (includeChiefAssignments) {
    await h.db.run(
      `INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, created_at, updated_at)
       VALUES
         ('assignment-A211', 101, 'staff-A211', 'ADMIN_TRANSFER', 'assignment-source-A211', 'active', '2026-01-01', ${now}, ${now}),
         ('assignment-B211', 102, 'staff-B211', 'ADMIN_TRANSFER', 'assignment-source-B211', 'active', '2026-01-01', ${now}, ${now}),
         ('assignment-C211', 103, 'staff-C211', 'ADMIN_TRANSFER', 'assignment-source-C211', 'active', '2026-01-01', ${now}, ${now});`,
    );
  }
  await h.db.run(
    `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES
       ('2026.2', 'A101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]'),
       ('2026.2', 'A301', '2026.1',
         '{"rank":["LT"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
  );
  await h.db.run(
    `UPDATE bid_years
        SET rule_book_version = '2026.2',
            position_template_version = '2026.1',
            config_json = '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-08-27"}',
            configuration_revision = 1
      WHERE year = 2026;`,
  );
}

describe('Division Chief administrative-assignment Bid policy', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('captures authoritative Division Chief assignments outside the Officer Pool and keeps A211/B211/C211 out of mock opportunities', async () => {
    await seedPolicyFixture(h);
    const create = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bid_year: 2026, is_mock: true }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string };

    const frozen = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${created.id}/policy-snapshot`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(frozen.status).toBe(200);
    const frozenBody = (await frozen.json()) as {
      snapshot: {
        v: number;
        members: Array<{ memberId: number; pool: string; exclusionReason: string | null }>;
      };
    };
    expect(frozenBody.snapshot).toMatchObject({ v: 3 });
    const byMember = new Map(
      frozenBody.snapshot.members.map((member) => [member.memberId, member]),
    );
    for (const memberId of [101, 102, 103]) {
      expect(byMember.get(memberId)).toMatchObject({
        pool: 'EXCLUDED',
        exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
      });
    }
    expect(byMember.get(104)).toMatchObject({ pool: 'OFC', exclusionReason: null });

    const eligibility = await app.fetch(
      new Request(`http://x/api/me/eligibility?session_id=${created.id}`, {
        headers: { Authorization: `Bearer ${await memberJwt(101, 'DC')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(eligibility.status).toBe(200);
    expect(await eligibility.json()).toMatchObject({
      excluded_from_bid_pool: true,
      positions: [],
    });

    // A later source mutation cannot silently re-admit a previously excluded
    // Division Chief to this already frozen session pool.
    await h.db.run(
      "UPDATE member_assignments SET status = 'ended', effective_to = '2026-08-26' WHERE id = 'assignment-A211';",
    );
    const afterSourceMutation = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${created.id}/policy-snapshot`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const afterSourceMutationBody = (await afterSourceMutation.json()) as {
      snapshot: { members: Array<{ memberId: number; pool: string }> };
    };
    expect(
      afterSourceMutationBody.snapshot.members.find((member) => member.memberId === 101),
    ).toMatchObject({ pool: 'EXCLUDED' });

    const autoBid = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${created.id}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'division-chief-assigned-auto-bid',
        },
        body: JSON.stringify({
          count: 1,
          strategy: 'first_eligible',
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(autoBid.status).toBe(200);
    expect(await autoBid.json()).toMatchObject({ picksMade: 1 });

    const manual = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${created.id}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'division-chief-assigned-manual-pick',
        },
        body: JSON.stringify({
          member_id: 105,
          position_id: 'A101',
          expected_mock_control_revision: 1,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(manual.status).toBe(201);

    const forceAdministrativePosition = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${created.id}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'division-chief-assigned-force-rejection',
        },
        body: JSON.stringify({
          member_id: 104,
          position_id: 'A211',
          force: true,
          expected_mock_control_revision: 2,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(forceAdministrativePosition.status).toBe(422);
    expect(await forceAdministrativePosition.json()).toMatchObject({
      error: 'position_not_biddable',
    });

    const order = await h.db.run(
      'SELECT member_id, pool FROM bid_order WHERE bid_session_id = ? ORDER BY ordinal',
      [created.id],
    );
    expect(order.results.map((row) => row.member_id)).toEqual([104, 105]);
    const bids = await h.db.run(
      'SELECT position_id FROM bids WHERE bid_session_id = ? ORDER BY ordinal',
      [created.id],
    );
    expect(bids.results.map((row) => row.position_id)).toEqual(['A301', 'A101']);
    expect(bids.results.map((row) => row.position_id)).not.toEqual(
      expect.arrayContaining(['A211', 'B211', 'C211']),
    );
  });

  it('does not turn a vacant administratively assigned Division Chief staffing slot into a rule-book opportunity', async () => {
    await seedPolicyFixture(h, { includeChiefAssignments: false });
    const create = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bid_year: 2026, is_mock: true }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };

    const autoBid = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${id}/auto-bid`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'division-chief-vacant-auto-bid',
        },
        body: JSON.stringify({
          count: 2,
          strategy: 'first_eligible',
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(autoBid.status).toBe(200);
    const bids = await h.db.run('SELECT position_id FROM bids WHERE bid_session_id = ?', [id]);
    expect(bids.results.map((row) => row.position_id)).not.toEqual(
      expect.arrayContaining(['A211', 'B211', 'C211']),
    );
  });

  it('fails closed when the administrative-staffing bridge has not been reviewed', async () => {
    await seedPolicyFixture(h, { bindingReviewStatus: 'draft' });
    const create = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bid_year: 2026, is_mock: true }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(create.status).toBe(409);
    expect(await create.json()).toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'non_biddable_position_staffing_binding_not_approved',
      position_ids: ['A211', 'B211', 'C211'],
    });
  });
});

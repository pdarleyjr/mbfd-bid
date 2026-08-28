import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'p'.repeat(64);
const SESSION_ID = '01HZZ0000000000000000POLICY';
const CAPTURED_AT = Date.UTC(2026, 7, 27, 12, 0, 0);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Admin',
      last_name: 'Policy',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function seedPolicyFixture(h: TestD1, withSnapshot: boolean): Promise<void> {
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
  await h.db.run(
    `INSERT INTO bid_sessions
       (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
     VALUES ('${SESSION_ID}', 2026, ${CAPTURED_AT}, 'config', 180, 2, 0);`,
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES
       ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter'),
       ('A211', '2026.1', 'A', '2', 'Combat', '300', 'DC', 'Division Chief');`,
  );
  await h.db.run(
    `INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, rank_seniority, is_probationary, created_at, updated_at)
     VALUES
       (42, 'member-42', 'Member', '42', 'FF', 'FF', 42, 42, 0, ${CAPTURED_AT}, ${CAPTURED_AT}),
       (211, 'member-211', 'Member', '211', 'DC', 'OFC', 1, 1, 0, ${CAPTURED_AT}, ${CAPTURED_AT});`,
  );
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.2', 2026, 'draft');",
  );
  await h.db.run(
    `INSERT INTO rule_book_position_participation
       (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
     VALUES ('2026.2', 'A211', '2026.1', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'POL-015-test', ${CAPTURED_AT});`,
  );
  await h.db.run(
    `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES ('2026.2', 'A101', '2026.1',
       '{"rank":["FF"],"credentials":[],"custom":[]}',
       '{"max":0,"items":[]}',
       '["points","rsc_seniority","rank_seniority"]');`,
  );
  await h.db.run("UPDATE rule_books SET status = 'active' WHERE version = '2026.2';");

  if (!withSnapshot) return;
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, snapshot_json, captured_at)
     VALUES (?, '2026.2', '2026.1', ?, ?);`,
    [
      SESSION_ID,
      JSON.stringify({
        v: 1,
        ruleBookVersion: '2026.2',
        positionTemplateVersion: '2026.1',
        capturedAtMs: CAPTURED_AT,
        members: [
          {
            memberId: 42,
            pool: 'FF',
            rscSeniority: 42,
            rankSeniority: 42,
            exclusionReason: null,
            authoritativeAssignmentId: null,
          },
          {
            memberId: 211,
            pool: 'EXCLUDED',
            rscSeniority: 1,
            rankSeniority: 1,
            exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
            authoritativeAssignmentId: 'assignment-A211',
          },
        ],
      }),
      CAPTURED_AT,
    ],
  );
}

async function post(
  h: TestD1,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Response> {
  return app.fetch(
    new Request(`http://x${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
      },
      body: JSON.stringify(body),
    }),
    { ...h.env, JWT_SIGNING_KEY: KEY },
  );
}

describe('admin bid controls frozen-policy guard', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('fails closed when a legacy session has no immutable policy snapshot', async () => {
    await seedPolicyFixture(h, false);

    const res = await post(h, `/api/admin/bid-session/${SESSION_ID}/force-pick`, {
      member_id: 42,
      position_id: 'A101',
      reason_code: 'force.cert_mandate',
      reason: 'Policy snapshot is required before a forced pick.',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'session_policy_snapshot_missing' });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [SESSION_ID]))
        .results,
    ).toEqual([{ n: 0 }]);
  });

  it('rejects excluded Division Chief members and administrative positions across direct admin controls', async () => {
    await seedPolicyFixture(h, true);

    const excludedForce = await post(h, `/api/admin/bid-session/${SESSION_ID}/force-pick`, {
      member_id: 211,
      position_id: 'A101',
      reason_code: 'force.cert_mandate',
      reason: 'Attempt to force an excluded administrative assignment.',
    });
    expect(excludedForce.status).toBe(422);
    expect(await excludedForce.json()).toMatchObject({ error: 'member_excluded_from_bid_pool' });

    const administrativeForce = await post(h, `/api/admin/bid-session/${SESSION_ID}/force-pick`, {
      member_id: 42,
      position_id: 'A211',
      reason_code: 'force.cert_mandate',
      reason: 'Attempt to force a non-biddable administrative position.',
    });
    expect(administrativeForce.status).toBe(422);
    expect(await administrativeForce.json()).toMatchObject({ error: 'position_not_biddable' });

    const proxy = await post(h, `/api/admin/bid-session/${SESSION_ID}/bid-for-member`, {
      member_id: 42,
      position_id: 'A211',
      reason_code: 'bid_for_member.unreachable_phone',
      reason: 'Attempt to proxy bid an administrative position.',
    });
    expect(proxy.status).toBe(422);
    expect(await proxy.json()).toMatchObject({ error: 'position_not_biddable' });

    const lock = await post(h, `/api/admin/bid-session/${SESSION_ID}/lock-position`, {
      member_id: 211,
      position_id: 'A101',
      reason_code: 'lock_position.probationary_placement',
      reason: 'Attempt to lock an excluded Division Chief member.',
    });
    expect(lock.status).toBe(422);
    expect(await lock.json()).toMatchObject({ error: 'member_excluded_from_bid_pool' });

    const skip = await post(h, `/api/admin/bid-session/${SESSION_ID}/skip`, {
      member_id: 211,
      reason_code: 'skip.unreachable',
      reason: 'Attempt to skip an excluded Division Chief member.',
    });
    expect(skip.status).toBe(422);
    expect(await skip.json()).toMatchObject({ error: 'member_excluded_from_bid_pool' });

    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [SESSION_ID]))
        .results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS n FROM audit_log WHERE bid_session_id = ? AND action IN ('forced_pick', 'admin_bid_for_member', 'skip', 'lock_position')",
          [SESSION_ID],
        )
      ).results,
    ).toEqual([{ n: 0 }]);
  });

  it('does not replay a legacy idempotency record for a now non-biddable position', async () => {
    await seedPolicyFixture(h, true);
    await h.db.run(
      `INSERT INTO bids
       (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, reason, idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('legacy-non-biddable-bid', ?, 1, 42, 'A211', ?, 1, 'legacy policy record', 'legacy-policy-key', 'pending', 0);`,
      [SESSION_ID, CAPTURED_AT],
    );

    const res = await post(
      h,
      `/api/admin/bid-session/${SESSION_ID}/force-pick`,
      {
        member_id: 42,
        position_id: 'A211',
        reason_code: 'force.cert_mandate',
        reason: 'A stale idempotency key cannot bypass frozen policy.',
      },
      'legacy-policy-key',
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'position_not_biddable' });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [SESSION_ID]))
        .results,
    ).toEqual([{ n: 1 }]);
  });
});

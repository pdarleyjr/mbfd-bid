import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signJwt } from '../../src/lib/jwt.js';
import bidAwardTransitionRouter from '../../src/routes/admin/bid-award-transition.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 't'.repeat(64);
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);
const SESSION_ID = '01HZZ0000000000000AWARD01';
const EFFECTIVE_ON = '2026-09-15';
const PRIOR_EFFECTIVE_ON = '2026-09-14';

function app() {
  return new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>().route(
    '/api/admin/bid-award-transition',
    bidAwardTransitionRouter,
  );
}

async function adminJwt(fresh = true): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      ...(fresh ? { fresh_auth_at: Math.floor(Date.now() / 1000) } : {}),
    },
    KEY,
  );
}

async function request(h: TestD1, path: string, options: RequestInit = {}): Promise<Response> {
  return app().request(path, options, { ...h.env, JWT_SIGNING_KEY: KEY });
}

async function seedCompletedBid(
  h: TestD1,
  options: { isMock?: boolean; completedAt?: number | null } = {},
): Promise<void> {
  const isMock = options.isMock === true ? 1 : 0;
  const completedAt = options.completedAt === undefined ? NOW : options.completedAt;
  await h.db.run(
    `INSERT INTO bid_years (year, status) VALUES (2026, 'complete');

     INSERT INTO bid_sessions
       (id, bid_year, started_at, completed_at, current_phase, turn_timer_seconds,
        expected_duration_days, day_count, is_mock)
     VALUES ('${SESSION_ID}', 2026, ${NOW}, ${completedAt === null ? 'NULL' : completedAt},
             'complete', 180, 2, 2, ${isMock});

     INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);
     INSERT INTO rule_books (version, effective_year, status, revision)
       VALUES ('2026.1', 2026, 'draft', 0);
     INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES
       ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Engine 1 FF'),
       ('B202', '2026.1', 'B', '2', 'Combat', 'Rescue 2', 'LT', 'Rescue 2 LT');
     INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria,
        points_preference, tie_break_chain)
     VALUES
       ('2026.1', 'A101', '2026.1',
        '{"rank":["FF"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]'),
       ('2026.1', 'B202', '2026.1',
        '{"rank":["LT"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]');
     INSERT INTO rule_book_position_participation
       (rule_book_version, position_id, template_version, bid_participation,
        authoritative_source_ref, created_at)
     VALUES
       ('2026.1', 'A101', '2026.1', 'BIDDABLE', 'synthetic/A101', ${NOW}),
       ('2026.1', 'B202', '2026.1', 'BIDDABLE', 'synthetic/B202', ${NOW});
     UPDATE rule_books SET status = 'active' WHERE version = '2026.1';

     INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
        is_probationary, employment_status, employment_status_effective_on, created_at, updated_at)
     VALUES
       (100, 'EMP100', 'Anna', 'Adams', 'FF', 'FF', 10, 0, 'active', '2020-01-01', ${NOW}, ${NOW}),
       (101, 'EMP101', 'Bea', 'Brown', 'LT', 'OFC', 11, 0, 'active', '2020-01-01', ${NOW}, ${NOW});

     INSERT INTO staffing_positions
       (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
        active_from, review_status, created_at, updated_at)
     VALUES
       ('slot-current-ff', 'SYNTHETIC/A/1/CURRENT-FF', 'A', '1', 'Engine', 'Current FF', 'FF',
        '2020-01-01', 'approved', ${NOW}, ${NOW}),
       ('slot-current-lt', 'SYNTHETIC/B/2/CURRENT-LT', 'B', '2', 'Rescue', 'Current LT', 'LT',
        '2020-01-01', 'approved', ${NOW}, ${NOW}),
       ('slot-award-ff', 'SYNTHETIC/A/1/AWARD-FF', 'A', '1', 'Engine', 'Award FF', 'FF',
        '2020-01-01', 'approved', ${NOW}, ${NOW}),
       ('slot-award-lt', 'SYNTHETIC/B/2/AWARD-LT', 'B', '2', 'Rescue', 'Award LT', 'LT',
        '2020-01-01', 'approved', ${NOW}, ${NOW});
     INSERT INTO position_staffing_bindings
       (position_id, template_version, staffing_position_id, authoritative_source_ref,
        review_status, created_at)
     VALUES
       ('A101', '2026.1', 'slot-award-ff', 'synthetic/A101', 'approved', ${NOW}),
       ('B202', '2026.1', 'slot-award-lt', 'synthetic/B202', 'approved', ${NOW});

     INSERT INTO member_assignments
       (id, member_id, staffing_position_id, origin_type, origin_ref, status,
        effective_from, effective_to, created_at, updated_at)
     VALUES
       ('assignment-current-ff', 100, 'slot-current-ff', 'ADMIN_TRANSFER', 'synthetic/current/ff',
        'active', '2020-01-01', NULL, ${NOW}, ${NOW}),
       ('assignment-current-lt', 101, 'slot-current-lt', 'ADMIN_TRANSFER', 'synthetic/current/lt',
        'active', '2020-01-01', NULL, ${NOW}, ${NOW});

     INSERT INTO bids
       (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
        idempotency_key, portal_sync_status, portal_sync_attempts)
     VALUES
       ('bid-award-ff', '${SESSION_ID}', 1, 100, 'A101', ${NOW}, 0, 'synthetic-award-ff', 'pending', 0),
       ('bid-award-lt', '${SESSION_ID}', 2, 101, 'B202', ${NOW}, 0, 'synthetic-award-lt', 'pending', 0);`,
  );

  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision,
        snapshot_json, captured_at)
     VALUES (?, '2026.1', '2026.1', 0, ?, ?);`,
    [
      SESSION_ID,
      JSON.stringify({
        v: 3,
        ruleBookVersion: '2026.1',
        ruleBookRevision: 0,
        positionTemplateVersion: '2026.1',
        configurationRevision: 0,
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
        capturedAtMs: NOW,
        members: [
          {
            memberId: 100,
            pool: 'FF',
            rscSeniority: 10,
            rankSeniority: null,
            exclusionReason: null,
            authoritativeAssignmentId: 'assignment-current-ff',
            rank: 'FF',
            isProbationary: false,
            credentialNames: [],
          },
          {
            memberId: 101,
            pool: 'OFC',
            rscSeniority: 11,
            rankSeniority: null,
            exclusionReason: null,
            authoritativeAssignmentId: 'assignment-current-lt',
            rank: 'LT',
            isProbationary: false,
            credentialNames: [],
          },
        ],
        ruleBookMaterial: {
          v: 1,
          rules: [
            {
              ruleBookVersion: '2026.1',
              positionId: 'A101',
              templateVersion: '2026.1',
              requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
              pointsPreferenceJson: '{"max":0,"items":[]}',
              tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
            },
            {
              ruleBookVersion: '2026.1',
              positionId: 'B202',
              templateVersion: '2026.1',
              requiredCriteriaJson: '{"rank":["LT"],"credentials":[],"custom":[]}',
              pointsPreferenceJson: '{"max":0,"items":[]}',
              tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
            },
          ],
          positions: [
            {
              id: 'A101',
              templateVersion: '2026.1',
              bidParticipation: 'BIDDABLE',
              isExcludedFromCount: false,
              shift: 'A',
              station: '1',
              unit: 'Engine 1',
              rankRequired: 'FF',
              positionName: 'Engine 1 FF',
            },
            {
              id: 'B202',
              templateVersion: '2026.1',
              bidParticipation: 'BIDDABLE',
              isExcludedFromCount: false,
              shift: 'B',
              station: '2',
              unit: 'Rescue 2',
              rankRequired: 'LT',
              positionName: 'Rescue 2 LT',
            },
          ],
        },
      }),
      NOW,
    ],
  );
}

describe('Bid award transition administration', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await seedCompletedBid(h);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('previews the frozen award transition without writing assignments, events, or audit rows', async () => {
    const response = await request(
      h,
      `/api/admin/bid-award-transition/${SESSION_ID}/preview?effective_on=${EFFECTIVE_ON}`,
      { headers: { Authorization: `Bearer ${await adminJwt()}` } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      transition: {
        effectiveOn: string;
        currentToNew: Array<{
          currentAssignment: { id: string } | null;
          newAssignment: { staffingPositionId: string };
        }>;
      };
    };
    expect(body.transition.effectiveOn).toBe(EFFECTIVE_ON);
    expect(body.transition.currentToNew).toEqual([
      {
        ordinal: 1,
        awardId: 'bid-award-ff',
        memberId: 100,
        positionId: 'A101',
        currentAssignment: {
          id: 'assignment-current-ff',
          staffingPositionId: 'slot-current-ff',
          status: 'active',
          effectiveFrom: '2020-01-01',
          effectiveTo: null,
        },
        newAssignment: {
          staffingPositionId: 'slot-award-ff',
          effectiveFrom: EFFECTIVE_ON,
          originRef: `bid-award:${SESSION_ID}:bid-award-ff`,
          status: 'planned',
        },
      },
      {
        ordinal: 2,
        awardId: 'bid-award-lt',
        memberId: 101,
        positionId: 'B202',
        currentAssignment: {
          id: 'assignment-current-lt',
          staffingPositionId: 'slot-current-lt',
          status: 'active',
          effectiveFrom: '2020-01-01',
          effectiveTo: null,
        },
        newAssignment: {
          staffingPositionId: 'slot-award-lt',
          effectiveFrom: EFFECTIVE_ON,
          originRef: `bid-award:${SESSION_ID}:bid-award-lt`,
          status: 'planned',
        },
      },
    ]);
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS count FROM member_assignments WHERE origin_type = 'BID_AWARD'",
        )
      ).results,
    ).toEqual([{ count: 0 }]);
    expect(
      (await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events')).results,
    ).toEqual([{ count: 0 }]);
    expect((await h.db.run('SELECT count(*) AS count FROM audit_log')).results).toEqual([
      { count: 0 },
    ]);
  });

  it('exports the same current-to-new plan as a no-store CSV without applying it', async () => {
    const response = await request(
      h,
      `/api/admin/bid-award-transition/${SESSION_ID}/transition.csv?effective_on=${EFFECTIVE_ON}`,
      { headers: { Authorization: `Bearer ${await adminJwt()}` } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/text\/csv/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toContain(
      `mbfd-bid-transition-${SESSION_ID}.csv`,
    );
    const lines = (await response.text()).split('\r\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('bid_session_id,as_of_date,effective_on,ordinal');
    expect(lines[1]).toContain(`${SESSION_ID},`);
    expect(lines[1]).toContain(`,${EFFECTIVE_ON},1,bid-award-ff,100,A101,`);
    expect(lines[2]).toContain(`,${EFFECTIVE_ON},2,bid-award-lt,101,B202,`);
    expect((await h.db.run('SELECT count(*) AS count FROM member_assignments')).results).toEqual([
      { count: 2 },
    ]);
    expect(
      (await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events')).results,
    ).toEqual([{ count: 0 }]);
  });

  it('applies only future-dated planned awards with immutable evidence and returns an idempotent receipt', async () => {
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-award-transition-001',
    };
    const body = {
      effective_on: EFFECTIVE_ON,
      reason: 'Synthetic completed Bid transition acceptance proof.',
    };
    const response = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(201);
    expect(responseBody).toMatchObject({ replayed: false, effectiveOn: EFFECTIVE_ON });
    expect(
      (
        await h.db.run(
          `SELECT id, member_id, staffing_position_id, origin_type, origin_ref, status,
                  effective_from, effective_to
             FROM member_assignments ORDER BY effective_from, member_id, id`,
        )
      ).results,
    ).toEqual([
      {
        id: 'assignment-current-ff',
        member_id: 100,
        staffing_position_id: 'slot-current-ff',
        origin_type: 'ADMIN_TRANSFER',
        origin_ref: 'synthetic/current/ff',
        status: 'active',
        effective_from: '2020-01-01',
        effective_to: PRIOR_EFFECTIVE_ON,
      },
      {
        id: 'assignment-current-lt',
        member_id: 101,
        staffing_position_id: 'slot-current-lt',
        origin_type: 'ADMIN_TRANSFER',
        origin_ref: 'synthetic/current/lt',
        status: 'active',
        effective_from: '2020-01-01',
        effective_to: PRIOR_EFFECTIVE_ON,
      },
      expect.objectContaining({
        member_id: 100,
        staffing_position_id: 'slot-award-ff',
        origin_type: 'BID_AWARD',
        origin_ref: `bid-award:${SESSION_ID}:bid-award-ff`,
        status: 'planned',
        effective_from: EFFECTIVE_ON,
        effective_to: null,
      }),
      expect.objectContaining({
        member_id: 101,
        staffing_position_id: 'slot-award-lt',
        origin_type: 'BID_AWARD',
        origin_ref: `bid-award:${SESSION_ID}:bid-award-lt`,
        status: 'planned',
        effective_from: EFFECTIVE_ON,
        effective_to: null,
      }),
    ]);

    const events = await h.db.run(
      `SELECT kind, effective_on, origin, actor_subject, reason, before_state, after_state
         FROM personnel_lifecycle_events ORDER BY member_id`,
    );
    expect(events.results).toHaveLength(2);
    expect(events.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ADMIN_REASSIGNMENT',
          effective_on: EFFECTIVE_ON,
          origin: 'BID',
          actor_subject: '0',
          reason: body.reason,
        }),
      ]),
    );
    expect(String(events.results[0]?.before_state)).toContain('assignment-current');
    expect(String(events.results[0]?.after_state)).toContain('BID_AWARD');

    const audit = await h.db.run(
      `SELECT action, actor_type, actor_id, target_kind, target_id, reason, before_state, after_state
         FROM audit_log WHERE bid_session_id = ?`,
      [SESSION_ID],
    );
    expect(audit.results).toEqual([
      expect.objectContaining({
        action: 'bid_award_transition',
        actor_type: 'admin',
        actor_id: 0,
        target_kind: 'bid_session',
        target_id: SESSION_ID,
        reason: body.reason,
      }),
    ]);
    expect(String(audit.results[0]?.before_state)).toContain('currentToNew');
    expect(String(audit.results[0]?.after_state)).toContain(EFFECTIVE_ON);
    expect(
      (await h.db.run('SELECT count(*) AS count FROM portal_writeback_queue')).results,
    ).toEqual([{ count: 0 }]);

    const replay = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      replayed: true,
      effectiveOn: EFFECTIVE_ON,
      portalWriteback: 'not_enqueued',
    });
    expect(
      (await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events')).results,
    ).toEqual([{ count: 2 }]);
    expect((await h.db.run('SELECT count(*) AS count FROM audit_log')).results).toEqual([
      { count: 1 },
    ]);

    const conflictingReplay = await request(
      h,
      `/api/admin/bid-award-transition/${SESSION_ID}/apply`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...body,
          reason: 'A different reason must not replay this transition.',
        }),
      },
    );
    expect(conflictingReplay.status).toBe(409);
    expect(await conflictingReplay.json()).toMatchObject({ error: 'idempotency_key_reused' });
  });

  it('requires a fresh step-up, idempotency key, reason, and a strictly future effective date', async () => {
    const stale = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt(false)}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-award-transition-002',
      },
      body: JSON.stringify({ effective_on: EFFECTIVE_ON, reason: 'Synthetic reason.' }),
    });
    expect(stale.status).toBe(401);

    const noIdempotency = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await adminJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ effective_on: EFFECTIVE_ON, reason: 'Synthetic reason.' }),
    });
    expect(noIdempotency.status).toBe(400);

    const invalidDate = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-award-transition-003',
      },
      body: JSON.stringify({ effective_on: '2026-08-28', reason: 'Synthetic reason.' }),
    });
    expect(invalidDate.status).toBe(409);
    expect(await invalidDate.json()).toMatchObject({ error: 'effective_on_must_be_future' });
    expect((await h.db.run('SELECT count(*) AS count FROM member_assignments')).results).toEqual([
      { count: 2 },
    ]);
  });

  it('fails closed for a mock session, incomplete awards, an unapproved binding, or missing completion evidence', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [SESSION_ID]);
    const mock = await request(
      h,
      `/api/admin/bid-award-transition/${SESSION_ID}/preview?effective_on=${EFFECTIVE_ON}`,
      { headers: { Authorization: `Bearer ${await adminJwt()}` } },
    );
    expect(mock.status).toBe(409);
    expect(await mock.json()).toMatchObject({ error: 'mock_session_not_transitionable' });

    await h.db.run('UPDATE bid_sessions SET is_mock = 0, completed_at = NULL WHERE id = ?', [
      SESSION_ID,
    ]);
    const missingCompletion = await request(
      h,
      `/api/admin/bid-award-transition/${SESSION_ID}/preview?effective_on=${EFFECTIVE_ON}`,
      { headers: { Authorization: `Bearer ${await adminJwt()}` } },
    );
    expect(missingCompletion.status).toBe(409);
    expect(await missingCompletion.json()).toMatchObject({ error: 'frozen_awards_required' });

    await h.db.run('UPDATE bid_sessions SET completed_at = ? WHERE id = ?', [NOW, SESSION_ID]);
    await h.db.run("DELETE FROM bids WHERE id = 'bid-award-lt'");
    const incomplete = await request(
      h,
      `/api/admin/bid-award-transition/${SESSION_ID}/preview?effective_on=${EFFECTIVE_ON}`,
      { headers: { Authorization: `Bearer ${await adminJwt()}` } },
    );
    expect(incomplete.status).toBe(409);
    expect(await incomplete.json()).toMatchObject({ error: 'incomplete_frozen_awards' });

    await h.db.run(
      `INSERT INTO bids
         (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
          idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('bid-award-lt', ?, 2, 101, 'B202', ?, 0, 'synthetic-award-lt', 'pending', 0)`,
      [SESSION_ID, NOW],
    );
    await h.db.run(
      "UPDATE position_staffing_bindings SET review_status = 'draft' WHERE position_id = 'B202'",
    );
    const unapproved = await request(
      h,
      `/api/admin/bid-award-transition/${SESSION_ID}/preview?effective_on=${EFFECTIVE_ON}`,
      { headers: { Authorization: `Bearer ${await adminJwt()}` } },
    );
    expect(unapproved.status).toBe(409);
    expect(await unapproved.json()).toMatchObject({ error: 'position_binding_not_approved' });
    expect(
      (await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events')).results,
    ).toEqual([{ count: 0 }]);
  });

  it('fails closed rather than replaying a receipt with a missing lifecycle event', async () => {
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-award-transition-partial-receipt',
    };
    const body = {
      effective_on: EFFECTIVE_ON,
      reason: 'Synthetic partial receipt recovery proof.',
    };
    const applied = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(applied.status).toBe(201);

    const events = await h.db.run('SELECT id FROM personnel_lifecycle_events ORDER BY id LIMIT 1');
    const eventId = events.results[0]?.id;
    if (typeof eventId !== 'string') throw new Error('expected a lifecycle receipt event');
    h.sqlite.exec('DROP TRIGGER personnel_lifecycle_events_are_immutable_delete;');
    await h.db.run('DELETE FROM personnel_lifecycle_events WHERE id = ?', [eventId]);

    const replay = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: 'transition_receipt_incomplete' });
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS count FROM member_assignments WHERE origin_type = 'BID_AWARD'",
        )
      ).results,
    ).toEqual([{ count: 2 }]);
  });

  it('fails closed rather than replaying a receipt whose created assignment no longer matches', async () => {
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-award-transition-corrupt-assignment',
    };
    const body = {
      effective_on: EFFECTIVE_ON,
      reason: 'Synthetic corrupt assignment recovery proof.',
    };
    const applied = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(applied.status).toBe(201);

    const assignments = await h.db.run(
      "SELECT id FROM member_assignments WHERE origin_type = 'BID_AWARD' ORDER BY id LIMIT 1",
    );
    const assignmentId = assignments.results[0]?.id;
    if (typeof assignmentId !== 'string') throw new Error('expected a created Bid assignment');
    await h.db.run(
      "UPDATE member_assignments SET origin_ref = 'corrupt/recovery-receipt' WHERE id = ?",
      [assignmentId],
    );

    const replay = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: 'transition_receipt_incomplete' });
  });

  it('fails closed rather than replaying a receipt with an unexpected lifecycle event', async () => {
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-award-transition-unexpected-event',
    };
    const body = {
      effective_on: EFFECTIVE_ON,
      reason: 'Synthetic unexpected event recovery proof.',
    };
    const applied = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(applied.status).toBe(201);

    const events = await h.db.run(
      'SELECT id, idempotency_key FROM personnel_lifecycle_events ORDER BY id LIMIT 1',
    );
    const sourceEventId = events.results[0]?.id;
    const sourceIdempotencyKey = events.results[0]?.idempotency_key;
    if (typeof sourceEventId !== 'string' || typeof sourceIdempotencyKey !== 'string') {
      throw new Error('expected a lifecycle receipt event');
    }
    await h.db.run(
      `INSERT INTO personnel_lifecycle_events
         (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
          employment_status_before, employment_status_after, rank_before, rank_after,
          separation_type, reason, origin, actor_subject, idempotency_key,
          before_state, after_state, supersedes_event_id, created_at)
       SELECT ?, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
              employment_status_before, employment_status_after, rank_before, rank_after,
              separation_type, reason, origin, actor_subject, ?,
              before_state, after_state, supersedes_event_id, created_at
         FROM personnel_lifecycle_events WHERE id = ?`,
      ['unexpected-transition-event', `${sourceIdempotencyKey}:unexpected`, sourceEventId],
    );

    const replay = await request(h, `/api/admin/bid-award-transition/${SESSION_ID}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: 'transition_receipt_incomplete' });
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '../../src/types/env.js';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'v'.repeat(64);
const TELESTAFF_HMAC_KEY = 'h'.repeat(64);
const NOW = Date.now();
const TODAY = utcDateAfter(0);
const TRANSITION_EFFECTIVE_ON = utcDateAfter(14);
const PERSONNEL_EFFECTIVE_ON = utcDateAfter(30);
const BID_YEAR = Number(TODAY.slice(0, 4));
const COMPLETED_SESSION_ID = '01HZZ0000000000000VERTICAL';
const MOCK_SESSION_ID = '01HZZ0000000000000MOCKSAFE';

function utcDateAfter(days: number): string {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'vertical-slice-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Operator',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function request(
  h: TestD1,
  path: string,
  init: RequestInit = {},
  envOverrides: Partial<WorkerEnv> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${await adminJwt()}`);
  return app.fetch(new Request(`http://x${path}`, { ...init, headers }), {
    ...h.env,
    JWT_SIGNING_KEY: KEY,
    TELESTAFF_HMAC_KEY,
    ...envOverrides,
  });
}

function sourceUploadWithInvalidSnapshot(): FormData {
  const source = new FormData();
  source.set(
    'file',
    new File(
      [
        '<table><thead><tr><th>Name</th><th>Emp ID</th></tr></thead><tbody><tr><td>Safe Synthetic</td><td>VERTICAL-200</td></tr></tbody></table>',
      ],
      'synthetic-telestaff.html',
      { type: 'text/html' },
    ),
  );
  source.set('source_kind', 'synthetic_test');
  // A calendar-invalid source date must fail before an import can be persisted.
  source.set('source_snapshot_as_of', '2026-02-30');
  return source;
}

function noDispatchBidSessionNamespace(calls: string[]): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async () => {
      calls.push('dispatch');
      return new Response(JSON.stringify({ unexpected: true }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'vertical-slice-do' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'vertical-slice-do' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

async function seedVerticalSlice(h: TestD1): Promise<void> {
  await h.db.run(
    `INSERT INTO position_templates (version, effective_year) VALUES ('vertical.v1', ${BID_YEAR});
     INSERT INTO rule_books (version, effective_year, status, revision)
       VALUES ('vertical.v1', ${BID_YEAR}, 'draft', 0);
     INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES ('A101', 'vertical.v1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Engine 1 FF');
     INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria,
        points_preference, tie_break_chain)
       VALUES ('vertical.v1', 'A101', 'vertical.v1',
        '{"rank":["FF"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]');
     INSERT INTO rule_book_position_participation
       (rule_book_version, position_id, template_version, bid_participation,
        authoritative_source_ref, created_at)
       VALUES ('vertical.v1', 'A101', 'vertical.v1', 'BIDDABLE', 'synthetic/vertical/A101', ${NOW});
     UPDATE rule_books SET status = 'active' WHERE version = 'vertical.v1';
     INSERT INTO bid_years
       (year, status, position_template_version, rule_book_version, configuration_revision)
       VALUES (${BID_YEAR}, 'complete', 'vertical.v1', 'vertical.v1', 0);

     INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
        is_probationary, employment_status, employment_status_effective_on, created_at, updated_at)
       VALUES
       (100, 'VERTICAL-100', 'Bid', 'Member', 'FF', 'FF', 10, 0, 'active', '2020-01-01', ${NOW}, ${NOW}),
       (200, 'VERTICAL-200', 'Personnel', 'Member', 'FF', 'FF', 20, 0, 'active', '2020-01-01', ${NOW}, ${NOW});

     INSERT INTO staffing_positions
       (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
        active_from, review_status, created_at, updated_at)
       VALUES
       ('slot-current-bid', 'VERTICAL/A/1/CURRENT-FF', 'A', '1', 'Engine 1', 'Current FF', 'FF',
        '2020-01-01', 'approved', ${NOW}, ${NOW}),
       ('slot-award-bid', 'VERTICAL/A/1/AWARD-FF', 'A', '1', 'Engine 1', 'Award FF', 'FF',
        '2020-01-01', 'approved', ${NOW}, ${NOW}),
       ('slot-personnel-current', 'VERTICAL/A/2/CURRENT-FF', 'A', '2', 'Engine 2', 'Personnel FF', 'FF',
        '2020-01-01', 'approved', ${NOW}, ${NOW}),
       ('slot-personnel-promotion', 'VERTICAL/A/2/PROMOTION-LT', 'A', '2', 'Engine 2', 'Personnel LT', 'LT',
        '2020-01-01', 'approved', ${NOW}, ${NOW});
     INSERT INTO position_staffing_bindings
       (position_id, template_version, staffing_position_id, authoritative_source_ref,
        review_status, created_at)
       VALUES ('A101', 'vertical.v1', 'slot-award-bid', 'synthetic/vertical/A101', 'approved', ${NOW});
     INSERT INTO member_assignments
       (id, member_id, staffing_position_id, origin_type, origin_ref, status,
        effective_from, effective_to, created_at, updated_at)
       VALUES
       ('assignment-current-bid', 100, 'slot-current-bid', 'ADMIN_TRANSFER', 'synthetic/vertical/bid',
        'active', '2020-01-01', NULL, ${NOW}, ${NOW}),
       ('assignment-current-personnel', 200, 'slot-personnel-current', 'ADMIN_TRANSFER', 'synthetic/vertical/personnel',
        'active', '2020-01-01', NULL, ${NOW}, ${NOW});

     INSERT INTO bid_sessions
       (id, bid_year, started_at, completed_at, current_phase, turn_timer_seconds,
        expected_duration_days, day_count, is_mock)
       VALUES
       ('${COMPLETED_SESSION_ID}', ${BID_YEAR}, ${NOW}, ${NOW}, 'complete', 180, 2, 2, 0),
       ('${MOCK_SESSION_ID}', ${BID_YEAR}, ${NOW}, NULL, 'position_bid', 180, 2, 1, 1);
     INSERT INTO bids
       (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
        idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('bid-award-ff', '${COMPLETED_SESSION_ID}', 1, 100, 'A101', ${NOW}, 0,
        'synthetic-vertical-award', 'pending', 0);`,
  );

  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision,
        snapshot_json, captured_at)
       VALUES (?, 'vertical.v1', 'vertical.v1', 0, ?, ?);`,
    [
      COMPLETED_SESSION_ID,
      JSON.stringify({
        v: 3,
        ruleBookVersion: 'vertical.v1',
        ruleBookRevision: 0,
        positionTemplateVersion: 'vertical.v1',
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
            authoritativeAssignmentId: 'assignment-current-bid',
            rank: 'FF',
            isProbationary: false,
            credentialNames: [],
          },
        ],
        ruleBookMaterial: {
          v: 1,
          rules: [
            {
              ruleBookVersion: 'vertical.v1',
              positionId: 'A101',
              templateVersion: 'vertical.v1',
              requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
              pointsPreferenceJson: '{"max":0,"items":[]}',
              tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
            },
          ],
          positions: [
            {
              id: 'A101',
              templateVersion: 'vertical.v1',
              bidParticipation: 'BIDDABLE',
              isExcludedFromCount: false,
              shift: 'A',
              station: '1',
              unit: 'Engine 1',
              rankRequired: 'FF',
              positionName: 'Engine 1 FF',
            },
          ],
        },
      }),
      NOW,
    ],
  );
}

describe('synthetic operator vertical-slice route smoke', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await seedVerticalSlice(h);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('keeps effective-dated personnel, external-source, read/export, mock, and award-transition routes inside their safety boundaries', async () => {
    const personnel = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'vertical-personnel-promotion-001',
      },
      body: JSON.stringify({
        kind: 'PROMOTION',
        member_id: 200,
        staffing_position_id: 'slot-personnel-promotion',
        rank_after: 'LT',
        effective_on: PERSONNEL_EFFECTIVE_ON,
        reason: 'Synthetic vertical-slice future personnel promotion.',
      }),
    });
    expect(personnel.status).toBe(201);
    expect(await personnel.json()).toMatchObject({
      replayed: false,
      event: { kind: 'PROMOTION', effectiveOn: PERSONNEL_EFFECTIVE_ON },
    });

    const history = await request(h, '/api/admin/personnel/members/200/history');
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      lifecycleEvents: [
        expect.objectContaining({
          kind: 'PROMOTION',
          effectiveOn: PERSONNEL_EFFECTIVE_ON,
          rankBefore: 'FF',
          rankAfter: 'LT',
        }),
      ],
      assignments: expect.arrayContaining([
        expect.objectContaining({
          staffingPositionId: 'slot-personnel-promotion',
          status: 'planned',
          effectiveFrom: PERSONNEL_EFFECTIVE_ON,
        }),
      ]),
    });

    const beforeRosterRead = await h.db.run(
      'SELECT id, status, effective_to FROM member_assignments ORDER BY id',
    );
    const roster = await request(
      h,
      `/api/admin/current-roster?as_of=${PERSONNEL_EFFECTIVE_ON}&shift=A`,
    );
    expect(roster.status).toBe(200);
    expect(await roster.json()).toMatchObject({
      asOf: PERSONNEL_EFFECTIVE_ON,
      positions: expect.arrayContaining([
        expect.objectContaining({
          id: 'slot-personnel-promotion',
          occupancy: 'occupied',
          assignment: expect.objectContaining({ status: 'planned', memberId: 200 }),
          member: expect.objectContaining({ id: 200, rank: 'LT' }),
        }),
      ]),
    });
    const rosterCsv = await request(
      h,
      `/api/admin/current-roster/export.csv?as_of=${PERSONNEL_EFFECTIVE_ON}&shift=A`,
    );
    expect(rosterCsv.status).toBe(200);
    expect(rosterCsv.headers.get('Content-Type')).toMatch(/text\/csv/);
    expect(rosterCsv.headers.get('Cache-Control')).toBe('no-store');
    expect(await rosterCsv.text()).toContain('VERTICAL/A/2/PROMOTION-LT');
    expect(
      (await h.db.run('SELECT id, status, effective_to FROM member_assignments ORDER BY id'))
        .results,
    ).toEqual(beforeRosterRead.results);

    const rejectedTeleStaff = await request(h, '/api/admin/telestaff/imports', {
      method: 'POST',
      body: sourceUploadWithInvalidSnapshot(),
    });
    expect(rejectedTeleStaff.status).toBe(400);
    await expect(rejectedTeleStaff.json()).resolves.toEqual({
      error: 'invalid_source_snapshot_as_of',
    });
    expect((await h.db.run('SELECT COUNT(*) AS count FROM assignment_imports')).results).toEqual([
      { count: 0 },
    ]);

    const dispatched: string[] = [];
    const mockFreeze = await request(
      h,
      '/api/admin/bid/freeze',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
        },
        body: JSON.stringify({
          bidSessionId: MOCK_SESSION_ID,
          reason: 'Synthetic mock session must not dispatch generic commands.',
        }),
      },
      { BID_SESSION: noDispatchBidSessionNamespace(dispatched) },
    );
    expect(mockFreeze.status).toBe(409);
    await expect(mockFreeze.json()).resolves.toEqual({
      error: 'mock_session_requires_rehearsal_command',
    });
    expect(dispatched).toEqual([]);

    const beforePreview = await h.db.run(
      `SELECT
         (SELECT COUNT(*) FROM member_assignments WHERE origin_type = 'BID_AWARD') AS awards,
         (SELECT COUNT(*) FROM personnel_lifecycle_events WHERE origin = 'BID') AS bid_events,
         (SELECT COUNT(*) FROM audit_log WHERE action = 'bid_award_transition') AS audit_rows`,
    );
    const preview = await request(
      h,
      `/api/admin/bid-award-transition/${COMPLETED_SESSION_ID}/preview?effective_on=${TRANSITION_EFFECTIVE_ON}`,
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      transition: {
        bidSessionId: COMPLETED_SESSION_ID,
        effectiveOn: TRANSITION_EFFECTIVE_ON,
        currentToNew: [
          expect.objectContaining({
            awardId: 'bid-award-ff',
            memberId: 100,
            positionId: 'A101',
            newAssignment: expect.objectContaining({
              staffingPositionId: 'slot-award-bid',
              status: 'planned',
            }),
          }),
        ],
      },
    });
    expect(
      (
        await h.db.run(
          `SELECT
             (SELECT COUNT(*) FROM member_assignments WHERE origin_type = 'BID_AWARD') AS awards,
             (SELECT COUNT(*) FROM personnel_lifecycle_events WHERE origin = 'BID') AS bid_events,
             (SELECT COUNT(*) FROM audit_log WHERE action = 'bid_award_transition') AS audit_rows`,
        )
      ).results,
    ).toEqual(beforePreview.results);

    const transitionHeaders = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'vertical-award-transition-001',
    };
    const transitionBody = {
      effective_on: TRANSITION_EFFECTIVE_ON,
      reason: 'Synthetic vertical-slice transition receipt.',
    };
    const applied = await request(
      h,
      `/api/admin/bid-award-transition/${COMPLETED_SESSION_ID}/apply`,
      { method: 'POST', headers: transitionHeaders, body: JSON.stringify(transitionBody) },
    );
    expect(applied.status).toBe(201);
    expect(await applied.json()).toMatchObject({
      replayed: false,
      effectiveOn: TRANSITION_EFFECTIVE_ON,
      portalWriteback: 'not_enqueued',
    });

    const replay = await request(
      h,
      `/api/admin/bid-award-transition/${COMPLETED_SESSION_ID}/apply`,
      { method: 'POST', headers: transitionHeaders, body: JSON.stringify(transitionBody) },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      replayed: true,
      effectiveOn: TRANSITION_EFFECTIVE_ON,
      portalWriteback: 'not_enqueued',
    });
    expect(
      (
        await h.db.run(
          `SELECT
             (SELECT COUNT(*) FROM member_assignments WHERE origin_type = 'BID_AWARD') AS awards,
             (SELECT COUNT(*) FROM personnel_lifecycle_events WHERE origin = 'BID') AS bid_events,
             (SELECT COUNT(*) FROM audit_log WHERE action = 'bid_award_transition') AS audit_rows,
             (SELECT COUNT(*) FROM portal_writeback_queue) AS portal_work`,
        )
      ).results,
    ).toEqual([{ awards: 1, bid_events: 1, audit_rows: 1, portal_work: 0 }]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'e'.repeat(64);
const SESSION_ID = '01HZZ0000000000000000ELIG01';

async function memberJwt(): Promise<string> {
  return signJwt(
    {
      sub: 60,
      emp: '60060',
      role: 'member',
      rank: 'FF',
      first_name: 'Member',
      last_name: 'Test',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('GET /api/me/eligibility', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    const now = Date.now();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [SESSION_ID, now],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (60, '60060', 'Member', 'Test', 'FF', 'FF', 80, 0, ?, ?);",
      [now, now],
    );
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES
         ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter'),
         ('B101', '2026.1', 'B', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter');`,
    );
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES
         ('2026.1', 'A101', '2026.1',
           '{"rank":["FF"],"credentials":[],"custom":[]}',
           '{"max":0,"items":[]}',
           '["points","rsc_seniority","rank_seniority"]'),
          ('2026.1', 'B101', '2026.1',
            '{"rank":["FF"],"credentials":[],"custom":[]}',
           '{"max":0,"items":[]}',
           '["points","rsc_seniority","rank_seniority"]');`,
    );
    await h.db.run(
      `INSERT INTO bids
       (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('filled-invalid-rule', ?, 1, 60, 'B101', ?, 0, 'filled-invalid-rule-key', 'pending', 0);`,
      [SESSION_ID, now],
    );
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
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
          capturedAtMs: now,
          members: [
            {
              memberId: 60,
              pool: 'FF',
              rscSeniority: 80,
              rankSeniority: null,
              exclusionReason: null,
              authoritativeAssignmentId: null,
              rank: 'FF',
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
                positionId: 'B101',
                templateVersion: '2026.1',
                requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
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
                positionName: 'Firefighter',
              },
              {
                id: 'B101',
                templateVersion: '2026.1',
                bidParticipation: 'BIDDABLE',
                isExcludedFromCount: false,
                shift: 'B',
                station: '1',
                unit: 'Engine 1',
                rankRequired: 'FF',
                positionName: 'Firefighter',
              },
            ],
          },
        }),
        now,
      ],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('replays immutable rule material when a later editable source rule becomes invalid', async () => {
    await h.db.run(
      `UPDATE position_rules
          SET required_criteria = '{"rank":["FF"],"credentials":[],"custom":["pre_bid_pool"]}'
        WHERE rule_book_version = '2026.1' AND position_id = 'B101';`,
    );
    const res = await app.fetch(
      new Request(`http://x/api/me/eligibility?session_id=${SESSION_ID}`, {
        headers: { Authorization: `Bearer ${await memberJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      rule_book_version: '2026.1',
      positions: [{ positionId: 'A101' }],
    });
  });

  it('fails closed for a legacy V1 session without immutable rule material', async () => {
    const capturedAt = Date.now();
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?', [
      SESSION_ID,
    ]);
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, snapshot_json, captured_at)
       VALUES (?, '2026.1', '2026.1', ?, ?);`,
      [
        SESSION_ID,
        JSON.stringify({
          v: 1,
          ruleBookVersion: '2026.1',
          positionTemplateVersion: '2026.1',
          capturedAtMs: capturedAt,
          members: [
            {
              memberId: 60,
              pool: 'FF',
              rscSeniority: 80,
              rankSeniority: null,
              exclusionReason: null,
              authoritativeAssignmentId: null,
            },
          ],
        }),
        capturedAt,
      ],
    );

    const res = await app.fetch(
      new Request(`http://x/api/me/eligibility?session_id=${SESSION_ID}`, {
        headers: { Authorization: `Bearer ${await memberJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_material_missing',
    });
  });

  it('rejects a requested draft or archived version instead of evaluating it', async () => {
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.2', 2026, 'draft');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.2', 'C101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );

    const res = await app.fetch(
      new Request(`http://x/api/me/eligibility?session_id=${SESSION_ID}&rule_book_version=2026.2`, {
        headers: { Authorization: `Bearer ${await memberJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'rule_book_version_not_active',
      requested_version: '2026.2',
      active_version: '2026.1',
    });
  });

  it('keeps evaluating a valid frozen rule book after it is archived for a later cycle', async () => {
    await h.db.run("UPDATE rule_books SET status = 'archived' WHERE version = '2026.1';");
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2027.1', 2027, 'active');",
    );
    const res = await app.fetch(
      new Request(`http://x/api/me/eligibility?session_id=${SESSION_ID}`, {
        headers: { Authorization: `Bearer ${await memberJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rule_book_version: string;
      positions: { positionId: string }[];
    };
    expect(body.rule_book_version).toBe('2026.1');
    expect(body.positions.map((position) => position.positionId)).toEqual(['A101']);
  });

  it('does not replace a frozen session rule book with a later active book', async () => {
    await h.db.run("UPDATE rule_books SET status = 'archived' WHERE version = '2026.1';");
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2027.1', 2027, 'active');",
    );

    const res = await app.fetch(
      new Request(`http://x/api/me/eligibility?session_id=${SESSION_ID}`, {
        headers: { Authorization: `Bearer ${await memberJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rule_book_version: string;
      positions: { positionId: string }[];
    };
    expect(body.rule_book_version).toBe('2026.1');
    expect(body.positions.map((position) => position.positionId)).toEqual(['A101']);
  });

  it('uses canonical fills instead of stale legacy bids after canonical authority is established', async () => {
    await h.db.run('DELETE FROM bids WHERE bid_session_id = ?', [SESSION_ID]);
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [SESSION_ID]);
    await h.db.run(
      `UPDATE position_rules
          SET required_criteria = '{"rank":["FF"],"credentials":[],"custom":[]}'
        WHERE rule_book_version = '2026.1' AND position_id = 'B101';`,
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 1, ?, 'freeze-command', 1, 1);`,
      [
        SESSION_ID,
        JSON.stringify({
          bidSessionId: SESSION_ID,
          currentPhase: 'paused',
          currentBidderId: null,
          turnStartedAtMs: 1,
          turnTimerSeconds: 180,
          lastSeq: 1,
          fills: { A101: { memberId: 60, ordinal: 1, bidId: 'canonical-a101' } },
          bidOrder: [],
          queueCursor: 0,
          frozenAt: 1,
          aDay: null,
        }),
      ],
    );

    const res = await app.fetch(
      new Request(`http://x/api/me/eligibility?session_id=${SESSION_ID}`, {
        headers: { Authorization: `Bearer ${await memberJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { positions: { positionId: string }[] };
    expect(body.positions.map((position) => position.positionId)).toEqual(['B101']);
  });
});

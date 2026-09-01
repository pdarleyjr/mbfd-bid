import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'e'.repeat(64);
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

describe('POST /api/admin/bid-session/:id/skip', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS20';
  beforeEach(async () => {
    h = await setupTestD1();
    const capturedAt = Date.now();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (50, '50050', 'Skip', 'Me', 'FF', 'FF', 100, 0, ?, ?);",
      [Date.now(), Date.now()],
    );
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter');",
    );
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'A101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
        (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
       VALUES (?, '2026.1', '2026.1', 0, ?, ?);`,
      [
        sessionId,
        JSON.stringify({
          v: 3,
          ruleBookVersion: '2026.1',
          ruleBookRevision: 0,
          positionTemplateVersion: '2026.1',
          configurationRevision: 0,
          settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
          capturedAtMs: capturedAt,
          members: [
            {
              memberId: 50,
              pool: 'FF',
              rscSeniority: 100,
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
            ],
          },
        }),
        capturedAt,
      ],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('rejects the legacy real-session endpoint without creating state or audit records', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/skip`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 50,
          reason_code: 'skip.unreachable',
          reason: 'No phone answer after 3 calls.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'live_action_policy_missing' });
    const audit = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'skip' AND bid_session_id = ?",
      [sessionId],
    );
    expect(audit.results[0]?.n).toBe(0);
    const bidsCount = await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    expect(bidsCount.results[0]?.n).toBe(0);
  });

  it('requires the canonical disposition command before legacy payload validation', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/skip`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 50,
          reason_code: 'force.reverse_seniority',
          reason: 'wrong tool',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
  });

  it('does not inspect or mutate a legacy real-session payload', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/skip`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 9999,
          reason_code: 'skip.declined',
          reason: 'unknown member',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'live_action_policy_missing' });
  });
});

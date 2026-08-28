import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'g'.repeat(64);
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

describe('POST /api/admin/bid-session/:id/lock-position', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS40';
  beforeEach(async () => {
    h = await setupTestD1();
    const capturedAt = Date.now();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, config_json) VALUES (?, 2026, ?, 'config', 180, 2, 0, NULL);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (70, '70070', 'Prob', 'Newhire', 'FF', 'FF', 230, 1, ?, ?);",
      [Date.now(), Date.now()],
    );
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES ('A105', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Probationary Firefighter');",
    );
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'A105', '2026.1',
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
              memberId: 70,
              pool: 'FF',
              rscSeniority: 230,
              rankSeniority: null,
              exclusionReason: null,
              authoritativeAssignmentId: null,
              rank: 'FF',
              isProbationary: true,
              credentialNames: [],
            },
          ],
          ruleBookMaterial: {
            v: 1,
            rules: [
              {
                ruleBookVersion: '2026.1',
                positionId: 'A105',
                templateVersion: '2026.1',
                requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
                pointsPreferenceJson: '{"max":0,"items":[]}',
                tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
              },
            ],
            positions: [
              {
                id: 'A105',
                templateVersion: '2026.1',
                bidParticipation: 'BIDDABLE',
                isExcludedFromCount: false,
                shift: 'A',
                station: '1',
                unit: 'Engine 1',
                rankRequired: 'FF',
                positionName: 'Probationary Firefighter',
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

  it('appends a lock to bid_sessions.config_json (creating it if NULL)', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/lock-position`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 70,
          position_id: 'A105',
          reason_code: 'lock_position.probationary_placement',
          reason: 'Probationary 2025-Q4 hire',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run('SELECT config_json FROM bid_sessions WHERE id = ?', [sessionId]);
    const cfgRow = rows.results[0] as { config_json: string | null } | undefined;
    const cfg = JSON.parse(cfgRow?.config_json ?? '{}');
    expect(cfg.position_locks).toEqual([{ position_id: 'A105', member_id: 70 }]);
  });

  it('returns 409 when the session is past config (locks are pre-bid only)', async () => {
    await h.db.run("UPDATE bid_sessions SET current_phase = 'position_bid' WHERE id = ?", [
      sessionId,
    ]);
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/lock-position`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 70,
          position_id: 'A105',
          reason_code: 'lock_position.probationary_placement',
          reason: 'too late',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
  });

  it('returns 409 when the position is already locked to another member', async () => {
    await h.db.run('UPDATE bid_sessions SET config_json = ? WHERE id = ?', [
      JSON.stringify({ position_locks: [{ position_id: 'A105', member_id: 99 }] }),
      sessionId,
    ]);
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/lock-position`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 70,
          position_id: 'A105',
          reason_code: 'lock_position.probationary_placement',
          reason: 'duplicate lock',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
  });
});

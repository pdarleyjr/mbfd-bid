import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'f'.repeat(64);
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

async function seedEligibleFireFighter(h: TestD1, sessionId: string) {
  const now = Date.now();
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
    [sessionId, now],
  );
  await h.db.run(
    "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (60, '60060', 'Proxy', 'Bid', 'FF', 'FF', 80, 0, ?, ?);",
    [now, now],
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Engine 1 FF');",
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
}

describe('POST /api/admin/bid-session/:id/bid-for-member', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS30';
  beforeEach(async () => {
    h = await setupTestD1();
    await seedEligibleFireFighter(h, sessionId);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('records a bid with forced=false and admin_actor_id set', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/bid-for-member`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          reason_code: 'bid_for_member.unreachable_phone',
          reason: 'Member radioed his pick.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bid_id: string; forced: false };
    expect(body.forced).toBe(false);
    const rows = await h.db.run(
      'SELECT forced, admin_actor_id, position_id FROM bids WHERE id = ?',
      [body.bid_id],
    );
    const r = rows.results[0] as
      | { forced: number; admin_actor_id: number; position_id: string }
      | undefined;
    expect(r?.forced).toBe(0);
    expect(r?.admin_actor_id).toBe(0);
  });

  it('returns 422 when member is ineligible for the position (LT-only slot)', async () => {
    // Change rule to require LT rank — our seeded member is FF.
    await h.db.run(
      `UPDATE position_rules SET required_criteria = '{"rank":["LT"],"credentials":[],"custom":[]}'
       WHERE position_id = 'A101' AND rule_book_version = '2026.1';`,
    );
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/bid-for-member`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          reason_code: 'bid_for_member.unreachable_phone',
          reason: 'should be rejected',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reasons: { code: string }[] };
    expect(body.error).toBe('ineligible');
    expect(body.reasons.some((r) => r.code === 'RANK_REQUIRED')).toBe(true);
  });

  it('audit entry uses action=admin_bid_for_member', async () => {
    await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/bid-for-member`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          reason_code: 'bid_for_member.unreachable_phone',
          reason: 'Proxy bid.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const rows = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'admin_bid_for_member' AND bid_session_id = ?",
      [sessionId],
    );
    expect(rows.results[0]?.n).toBe(1);
  });
});

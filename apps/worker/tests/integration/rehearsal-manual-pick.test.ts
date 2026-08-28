import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
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

async function seedMockSessionWithEligibleFF(
  h: TestD1,
  sessionId: string,
  opts?: { isMock?: boolean },
) {
  const now = Date.now();
  const isMock = opts?.isMock ?? true;
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, ?);",
    [sessionId, now, isMock ? 1 : 0],
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

describe('POST /api/admin/rehearsal/:sessionId/manual-pick', () => {
  let h: TestD1;
  const sessionId = '01HMANUAL000000000000000PICK';

  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('commits a pick on a mock session and writes the audit row', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 60, position_id: 'A101' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bid_id: string; forced: boolean };
    expect(body.forced).toBe(false);

    const bidRows = await h.db.run('SELECT member_id, position_id, forced FROM bids WHERE id = ?', [
      body.bid_id,
    ]);
    const r = bidRows.results[0] as
      | { member_id: number; position_id: string; forced: number }
      | undefined;
    expect(r?.member_id).toBe(60);
    expect(r?.position_id).toBe('A101');
    expect(r?.forced).toBe(0);

    const auditRows = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'admin_bid_for_member' AND bid_session_id = ?",
      [sessionId],
    );
    expect(auditRows.results[0]?.n).toBe(1);
  });

  it('rejects manual-pick after a canonical command has locked the mock session', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    await h.db.run(
      `INSERT INTO canonical_bid_session_state
       (bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at)
       VALUES (?, 0, ?, NULL, ?, ?);`,
      [
        sessionId,
        JSON.stringify({
          bidSessionId: sessionId,
          currentPhase: 'paused',
          frozenAt: 1,
          lastSeq: 0,
        }),
        Date.now(),
        Date.now(),
      ],
    );

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 60, position_id: 'A101' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'canonical_mutation_requires_command' });
    const bidRows = await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    expect(bidRows.results[0]).toMatchObject({ n: 0 });
    const auditRows = await h.db.run(
      'SELECT count(*) AS n FROM audit_log WHERE bid_session_id = ?',
      [sessionId],
    );
    expect(auditRows.results[0]).toMatchObject({ n: 0 });
  });

  it('refuses with 403 when the session is not a mock', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId, { isMock: false });
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 60, position_id: 'A101' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_mock_session');
  });

  it('refuses with 422 when the member is ineligible for the position', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    // Make the position LT-only so our seeded FF is ineligible.
    await h.db.run(
      `UPDATE position_rules SET required_criteria = '{"rank":["LT"],"credentials":[],"custom":[]}'
       WHERE position_id = 'A101' AND rule_book_version = '2026.1';`,
    );
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 60, position_id: 'A101' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reasons: { code: string }[] };
    expect(body.error).toBe('ineligible');
    expect(body.reasons.some((r) => r.code === 'RANK_REQUIRED')).toBe(true);
  });

  it('honours force=true to bypass eligibility', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    await h.db.run(
      `UPDATE position_rules SET required_criteria = '{"rank":["LT"],"credentials":[],"custom":[]}'
       WHERE position_id = 'A101' AND rule_book_version = '2026.1';`,
    );
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 60, position_id: 'A101', force: true }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bid_id: string; forced: boolean };
    expect(body.forced).toBe(true);
    const auditRows = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'forced_pick' AND bid_session_id = ?",
      [sessionId],
    );
    expect(auditRows.results[0]?.n).toBe(1);
  });

  it('does not let force=true bypass an invalid active rule book', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'B101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":["pre_bid_pool"]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 60, position_id: 'A101', force: true }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'rule_book_invalid',
    });
  });

  it('refuses with 409 when the position is already filled', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    // First pick succeeds.
    const first = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 60, position_id: 'A101' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(first.status).toBe(201);
    // Second pick targets the same position — should be rejected.
    const second = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 60, position_id: 'A101' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe('position_already_filled');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'd'.repeat(64);

async function freshAdmin(): Promise<string> {
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

describe('POST /api/admin/bid-session/:id/force-pick', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS10';
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (42, '12345', 'Force', 'Test', 'FF', 'FF', 200, 0, ?, ?);",
      [Date.now(), Date.now()],
    );
    await h.db.run(
      "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 1, 42, 'FF');",
      [sessionId],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('records a bid with forced=true and admin_actor_id', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'Minimum Paramedic staffing on A-shift Rescue.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bid_id: string; forced: true };
    expect(body.forced).toBe(true);

    const rows = await h.db.run(
      'SELECT forced, admin_actor_id, reason, position_id FROM bids WHERE id = ?',
      [body.bid_id],
    );
    const r = rows.results[0] as
      | { forced: number; admin_actor_id: number; reason: string; position_id: string }
      | undefined;
    expect(r?.forced).toBe(1);
    expect(r?.admin_actor_id).toBe(0);
    expect(r?.position_id).toBe('A205');
  });

  it('writes forced_pick audit entry', async () => {
    await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.reverse_seniority',
          reason: 'Last qualified bidder.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const audit = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'forced_pick' AND bid_session_id = ?",
      [sessionId],
    );
    expect(audit.results[0]?.n).toBe(1);
  });

  it('rejects a canonical session before creating a legacy bid or audit row', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [sessionId]);
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 1, ?, 'freeze-command', ?, ?)`,
      [sessionId, JSON.stringify({ bidSessionId: sessionId, lastSeq: 1 }), Date.now(), Date.now()],
    );

    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'Canonical authority blocks this legacy path.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'canonical_mutation_requires_command' });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [sessionId]))
        .results,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS n FROM audit_log WHERE bid_session_id = ? AND action = 'forced_pick'",
          [sessionId],
        )
      ).results,
    ).toEqual([{ n: 0 }]);
  });

  it('rejects skip.unreachable as a force-pick reason_code (400 invalid_reason_for_action)', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'skip.unreachable',
          reason: 'wrong category code',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('returns the same bid_id on idempotent retry (same Idempotency-Key header)', async () => {
    const key = 'idem-test-1';
    const make = async () =>
      app.fetch(
        new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await freshAdmin()}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({
            member_id: 42,
            position_id: 'A205',
            reason_code: 'force.cert_mandate',
            reason: 'idempotent retry',
          }),
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );
    const r1 = (await (await make()).json()) as { bid_id: string };
    const r2 = (await (await make()).json()) as { bid_id: string };
    expect(r1.bid_id).toBe(r2.bid_id);
  });

  it('returns 400 when reason text < 4 chars', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'a',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

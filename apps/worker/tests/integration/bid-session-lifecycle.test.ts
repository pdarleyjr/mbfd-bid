import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'c'.repeat(64);

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

describe('POST /api/admin/bid-session', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('creates a session in `config` phase', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bid_year: 2026,
          expected_duration_days: 2,
          turn_timer_seconds: 180,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; current_phase: string };
    expect(body.current_phase).toBe('config');
    expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID shape
  });

  it('rejects creation when bid_year does not exist', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bid_year: 2099,
          expected_duration_days: 2,
          turn_timer_seconds: 180,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/bid-session/:id/start', () => {
  let h: TestD1;
  let sessionId: string;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
    sessionId = '01HZZ0000000000000000SESS01';
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'config', 180, 2, 0);",
      [sessionId, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('allows a mock rehearsal to transition config -> position_bid', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [sessionId]);

    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const after = await h.db.run('SELECT current_phase FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    expect(after.results[0]?.current_phase).toBe('position_bid');
  });

  it('fails closed for a live session until readiness facts are implemented', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'readiness_blocked',
      readiness: {
        canStartLiveBid: false,
        overallStatus: 'NOT_CONFIGURED',
        blockingCheckIds: expect.arrayContaining(['policy', 'mock_test', 'portal']),
      },
    });
    const after = await h.db.run('SELECT current_phase FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    expect(after.results[0]?.current_phase).toBe('config');
  });

  it('exposes the same fail-closed readiness report to an administrator', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/readiness`, {
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: sessionId,
      is_mock: false,
      readiness: {
        canStartLiveBid: false,
        overallStatus: 'NOT_CONFIGURED',
        blockingCheckIds: expect.arrayContaining(['policy', 'mock_test', 'portal']),
      },
    });
  });

  it('writes audit log session_start', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [sessionId]);

    await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const audit = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'session_start' AND bid_session_id = ?",
      [sessionId],
    );
    expect(audit.results[0]?.n).toBe(1);
  });

  it('returns 409 when session is already past config', async () => {
    await h.db.run("UPDATE bid_sessions SET current_phase = 'position_bid' WHERE id = ?", [
      sessionId,
    ]);
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
  });
});

describe('POST /api/admin/bid-session/:id/pause', () => {
  let h: TestD1;
  let sessionId: string;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    sessionId = '01HZZ0000000000000000SESS02';
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('sets phase to paused and records paused_at', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/pause`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason_code: 'session.pause_emergency',
          reason: 'IT issue in admin room',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run('SELECT current_phase, paused_at FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    const r = rows.results[0] as { current_phase: string; paused_at: number | null } | undefined;
    expect(r?.current_phase).toBe('paused');
    expect(r?.paused_at).toBeGreaterThan(0);
  });

  it('returns 400 when reason missing', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/pause`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason_code: 'session.pause_emergency' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/bid-session/:id/resume', () => {
  let h: TestD1;
  let sessionId: string;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    sessionId = '01HZZ0000000000000000SESS03';
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, paused_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, ?, 'paused', 180, 2, 1);",
      [sessionId, Date.now() - 60000, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('transitions paused -> position_bid and clears paused_at', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/resume`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run('SELECT current_phase, paused_at FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    const r = rows.results[0] as { current_phase: string; paused_at: number | null } | undefined;
    expect(r?.current_phase).toBe('position_bid');
    expect(r?.paused_at).toBeNull();
  });
});

describe('POST /api/admin/bid-session/:id/day-end and day-start', () => {
  let h: TestD1;
  let sessionId: string;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    sessionId = '01HZZ0000000000000000SESS04';
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('day-end stamps scheduled_resume_at and pauses', async () => {
    const resumeTs = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/day-end`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scheduled_resume_at: resumeTs, reason: 'End of day 1.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run(
      'SELECT current_phase, scheduled_resume_at FROM bid_sessions WHERE id = ?',
      [sessionId],
    );
    const r = rows.results[0] as { current_phase: string; scheduled_resume_at: number } | undefined;
    expect(r?.current_phase).toBe('paused');
    expect(r?.scheduled_resume_at).toBe(new Date(resumeTs).getTime());
  });

  it('day-start resumes and increments day_count and clears scheduled_resume_at', async () => {
    await h.db.run(
      "UPDATE bid_sessions SET current_phase = 'paused', paused_at = ?, scheduled_resume_at = ? WHERE id = ?",
      [Date.now(), Date.now() + 3600000, sessionId],
    );
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/day-start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run(
      'SELECT current_phase, day_count, scheduled_resume_at FROM bid_sessions WHERE id = ?',
      [sessionId],
    );
    const r = rows.results[0] as
      | { current_phase: string; day_count: number; scheduled_resume_at: number | null }
      | undefined;
    expect(r?.current_phase).toBe('position_bid');
    expect(r?.day_count).toBe(2);
    expect(r?.scheduled_resume_at).toBeNull();
  });
});

describe('canonical command authority', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS05';

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 1);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 1, ?, 'freeze-command', ?, ?)`,
      [
        sessionId,
        JSON.stringify({
          bidSessionId: sessionId,
          currentPhase: 'paused',
          currentBidderId: null,
          turnStartedAtMs: 1,
          turnTimerSeconds: 180,
          lastSeq: 1,
          fills: {},
          bidOrder: [],
          queueCursor: 0,
          frozenAt: 1,
          aDay: null,
        }),
        Date.now(),
        Date.now(),
      ],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns a typed conflict instead of attempting a legacy timer mutation', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/config`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ turn_timer_seconds: 240 }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'canonical_mutation_requires_command' });
    expect(
      (await h.db.run('SELECT turn_timer_seconds FROM bid_sessions WHERE id = ?', [sessionId]))
        .results,
    ).toEqual([{ turn_timer_seconds: 180 }]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'c'.repeat(64);
const mockSessionId = '01HZZ0000000000000000CLOSE1';
const liveSessionId = '01HZZ0000000000000000CLOSE2';

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'A',
      last_name: 'B',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function closeMock(h: TestD1, sessionId = mockSessionId): Promise<Response> {
  return app.fetch(
    new Request(`http://x/api/admin/rehearsal/${sessionId}/close-mock`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Staging maintenance: stale rehearsal disposition.' }),
    }),
    { ...h.env, JWT_SIGNING_KEY: KEY },
  );
}

describe('POST /api/admin/rehearsal/:sessionId/close-mock', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, current_bidder_id, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 101, 180, 2, 1, 1);",
      [mockSessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [liveSessionId, Date.now()],
    );
    await h.db.run(
      "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (101, '100101', 'Mock', 'Bidder', 'FF', 'FF', 500, 0, ?, ?);",
      [Date.now(), Date.now()],
    );
    await h.db.run(
      "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES ('bid-close-1', ?, 1, 101, 'A205', ?, 0, 'close-idem-1', 'pending', 0);",
      [mockSessionId, Math.floor(Date.now() / 1000)],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('closes a legacy mock without deleting its rehearsal history and records an audit event', async () => {
    const res = await closeMock(h);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      id: mockSessionId,
      state: 'complete',
      idempotent: false,
    });
    await expect(
      h.db.run(
        'SELECT current_phase, current_bidder_id, current_turn_started_at, paused_at, scheduled_resume_at, completed_at FROM bid_sessions WHERE id = ?',
        [mockSessionId],
      ),
    ).resolves.toMatchObject({
      results: [
        expect.objectContaining({
          current_phase: 'complete',
          current_bidder_id: null,
          current_turn_started_at: null,
          paused_at: null,
          scheduled_resume_at: null,
          completed_at: expect.any(Number),
        }),
      ],
    });
    await expect(
      h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [mockSessionId]),
    ).resolves.toMatchObject({ results: [{ n: 1 }] });
    await expect(
      h.db.run(
        'SELECT action, reason FROM audit_log WHERE bid_session_id = ? ORDER BY created_at DESC LIMIT 1',
        [mockSessionId],
      ),
    ).resolves.toMatchObject({
      results: [
        expect.objectContaining({
          action: 'mock_session_closed',
          reason: 'Staging maintenance: stale rehearsal disposition.',
        }),
      ],
    });
  });

  it('leaves a stale mock open when the close audit receipt fails', async () => {
    h.failNextBatchAt(0);
    const response = await closeMock(h);

    expect(response.status).toBe(500);
    await expect(
      h.db.run('SELECT current_phase FROM bid_sessions WHERE id = ?', [mockSessionId]),
    ).resolves.toEqual({ results: [{ current_phase: 'position_bid' }] });
    await expect(
      h.db.run(
        "SELECT COUNT(*) AS n FROM audit_log WHERE bid_session_id = ? AND action = 'mock_session_closed'",
        [mockSessionId],
      ),
    ).resolves.toEqual({ results: [{ n: 0 }] });
  });

  it('is idempotent once the mock is closed', async () => {
    await closeMock(h);

    const replay = await closeMock(h);

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      id: mockSessionId,
      state: 'complete',
      idempotent: true,
    });
    await expect(
      h.db.run(
        "SELECT count(*) AS n FROM audit_log WHERE bid_session_id = ? AND action = 'mock_session_closed'",
        [mockSessionId],
      ),
    ).resolves.toMatchObject({ results: [{ n: 1 }] });
  });

  it('refuses to close a non-mock session', async () => {
    const res = await closeMock(h, liveSessionId);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'not_a_mock_session' });
    await expect(
      h.db.run('SELECT current_phase FROM bid_sessions WHERE id = ?', [liveSessionId]),
    ).resolves.toMatchObject({ results: [{ current_phase: 'position_bid' }] });
  });

  it('fails closed when a canonical session state exists', async () => {
    await h.db.run('DELETE FROM bids WHERE bid_session_id = ?', [mockSessionId]);
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 1, ?, 'existing-command', ?, ?)`,
      [
        mockSessionId,
        JSON.stringify({ bidSessionId: mockSessionId, currentPhase: 'position_bid', lastSeq: 1 }),
        Date.now(),
        Date.now(),
      ],
    );

    const res = await closeMock(h);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'canonical_mock_close_requires_command' });
    await expect(
      h.db.run('SELECT current_phase FROM bid_sessions WHERE id = ?', [mockSessionId]),
    ).resolves.toMatchObject({ results: [{ current_phase: 'position_bid' }] });
  });
});

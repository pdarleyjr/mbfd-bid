import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'r'.repeat(64);
const SESSION_ID = '01HZZ0000000000000REHCAN';

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Test',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('GET /api/admin/rehearsal/sessions canonical state projection', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      `INSERT INTO bid_sessions (
        id, bid_year, started_at, current_phase, current_bidder_id,
        turn_timer_seconds, expected_duration_days, day_count, is_mock
      ) VALUES (?, 2026, 1, 'position_bid', 42, 180, 2, 0, 1);`,
      [SESSION_ID],
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
          fills: {},
          bidOrder: [],
          queueCursor: 0,
          frozenAt: 1,
          aDay: null,
        }),
      ],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('does not expose stale legacy phase or bidder values for a canonical mock session', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rehearsal/sessions', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessions: [
        {
          id: SESSION_ID,
          bidYear: 2026,
          currentPhase: 'paused',
          currentBidderId: null,
          isMock: true,
          mockControlRevision: 0,
          lastPickedAtIso: null,
        },
      ],
    });
  });
});

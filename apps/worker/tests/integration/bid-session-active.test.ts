import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'a'.repeat(64);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Bid',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('GET /api/admin/bid-session/active', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns null when no open session exists', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session/active', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: unknown | null };
    expect(body.session).toBeNull();
  });

  it('rejects an unsupported active-session mode', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session/active?mode=mock', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_active_session_mode' });
  });

  it('returns the newest non-complete session', async () => {
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES ('old-live', 2026, ?, 'position_bid', 180, 2, 1), ('done', 2026, ?, 'complete', 180, 2, 1), ('new-live', 2026, ?, 'paused', 180, 2, 1);",
      [Date.now() - 10_000, Date.now() - 5_000, Date.now()],
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session/active', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { id: string; currentPhase: string } | null };
    expect(body.session?.id).toBe('new-live');
    expect(body.session?.currentPhase).toBe('paused');
  });

  it('returns the newest non-complete real session when live mode excludes mocks', async () => {
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES ('live-session', 2026, ?, 'position_bid', 180, 2, 1, 0), ('newer-mock', 2026, ?, 'config', 180, 2, 1, 1);",
      [Date.now() - 10_000, Date.now()],
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session/active?mode=live', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { id: string; isMock: boolean } | null };
    expect(body.session).toMatchObject({ id: 'live-session', isMock: false });
  });

  it('projects canonical state over stale legacy session fields', async () => {
    const canonicalFrozenAt = 1_700_000_000_000;
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES ('canonical-active', 2026, ?, 'position_bid', 180, 2, 1, 1);",
      [Date.now()],
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 1, ?, 'freeze-command', ?, ?)`,
      [
        'canonical-active',
        JSON.stringify({
          bidSessionId: 'canonical-active',
          currentPhase: 'paused',
          currentBidderId: null,
          turnStartedAtMs: canonicalFrozenAt - 1000,
          turnTimerSeconds: 240,
          lastSeq: 1,
          fills: {},
          bidOrder: [],
          queueCursor: 0,
          frozenAt: canonicalFrozenAt,
          aDay: null,
        }),
        canonicalFrozenAt,
        canonicalFrozenAt,
      ],
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session/active', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: {
        id: string;
        currentPhase: string;
        turnTimerSeconds: number;
        frozenAt: string | null;
      } | null;
    };
    expect(body.session).toMatchObject({
      id: 'canonical-active',
      currentPhase: 'paused',
      turnTimerSeconds: 240,
      frozenAt: new Date(canonicalFrozenAt).toISOString(),
    });
  });
});

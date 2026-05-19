import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'k'.repeat(64);
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

async function seedTwoBids(h: TestD1, sessionId: string) {
  const now = Date.now();
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
    [sessionId, now],
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    `INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES
       ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Engine 1 FF'),
       ('B202', '2026.1', 'B', '2', 'Rescue', 'Rescue 2', 'LT', 'Rescue 2 LT');`,
  );
  await h.db.run(
    `INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at)
     VALUES
       (100, 'EMP100', 'Anna', 'Adams', 'FF', 'FF', 10, 0, ?, ?),
       (101, 'EMP101', 'Bea', 'Brown, Jr.', 'LT', 'OFC', 11, 0, ?, ?);`,
    [now, now, now, now],
  );
  await h.db.run(
    `INSERT INTO bids
     (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
     VALUES
       ('01HZZBID000000000000ORD1', ?, 1, 100, 'A101', ?, 0, 'k1', 'pending', 0),
       ('01HZZBID000000000000ORD2', ?, 2, 101, 'B202', ?, 1, 'k2', 'pending', 0);`,
    [sessionId, now, sessionId, now],
  );
}

describe('GET /api/admin/placements/export', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS50';
  beforeEach(async () => {
    h = await setupTestD1();
    await seedTwoBids(h, sessionId);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('emits header + one row per bid in ordinal asc order', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/placements/export?bid_session_id=${sessionId}&format=csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
    const lines = (await res.text()).split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'ordinal,member_employee_id,member_name,position_id,position_name,shift,station,a_day,forced,admin_actor_id,picked_at',
    );
    expect(lines[1]).toMatch(/^1,EMP100,/);
    expect(lines[2]).toMatch(/^2,EMP101,/);
  });

  it('quotes member_name containing comma (RFC 4180)', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/placements/export?bid_session_id=${sessionId}&format=csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = await res.text();
    expect(body).toContain('"Brown, Jr., Bea"');
  });

  it('returns 400 when bid_session_id is missing', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/placements/export?format=csv', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when bid_session_id does not exist', async () => {
    const res = await app.fetch(
      new Request(
        'http://x/api/admin/placements/export?bid_session_id=01HZZNONE0000000000000X&format=csv',
        {
          headers: { Authorization: `Bearer ${await adminJwt()}` },
        },
      ),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(404);
  });
});

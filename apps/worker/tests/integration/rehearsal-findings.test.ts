import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'f'.repeat(64);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 7,
      emp: '7admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'F',
      last_name: 'A',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function memberJwt(): Promise<string> {
  return signJwt(
    {
      sub: 1234,
      emp: 'm1234',
      role: 'member',
      rank: 'FF',
      first_name: 'M',
      last_name: 'M',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('Rehearsal findings CRUD (Task R6)', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000REH020';

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 1);",
      [sessionId, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('POST findings is admin-only (401 / 403)', async () => {
    const r1 = await app.fetch(
      new Request('http://x/api/admin/rehearsal/findings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bidSessionId: sessionId, note: 'x' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(r1.status).toBe(401);

    const r2 = await app.fetch(
      new Request('http://x/api/admin/rehearsal/findings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await memberJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bidSessionId: sessionId, note: 'x' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(r2.status).toBe(403);
  });

  it('POST returns 404 when bid session does not exist', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rehearsal/findings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bidSessionId: '01HNOTREAL', note: 'orphan' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(404);
  });

  it('POST inserts and GET returns the round-tripped row', async () => {
    const postRes = await app.fetch(
      new Request('http://x/api/admin/rehearsal/findings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bidSessionId: sessionId,
          note: 'Force-pick eligibility hint was wrong',
          screenshotR2Key: 'findings/2026/r2-key-abc',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(postRes.status).toBe(201);
    const created = (await postRes.json()) as {
      id: string;
      bidSessionId: string;
      note: string;
      screenshotR2Key: string | null;
    };
    expect(created.bidSessionId).toBe(sessionId);
    expect(created.note).toBe('Force-pick eligibility hint was wrong');
    expect(created.screenshotR2Key).toBe('findings/2026/r2-key-abc');

    const getRes = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/findings?session_id=${sessionId}&limit=50`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(getRes.status).toBe(200);
    const list = (await getRes.json()) as {
      findings: Array<{ id: string; note: string }>;
    };
    expect(list.findings.length).toBe(1);
    expect(list.findings[0]?.id).toBe(created.id);
  });

  it('GET returns 400 when session_id is missing', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rehearsal/findings', {
        method: 'GET',
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

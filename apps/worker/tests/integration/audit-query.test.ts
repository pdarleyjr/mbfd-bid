import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'h'.repeat(64);
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

async function seedAudit(h: TestD1, count: number, action = 'forced_pick', startIdx = 0) {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const j = startIdx + i;
    await h.db.run(
      "INSERT INTO audit_log (id, bid_session_id, seq, actor_type, actor_id, action, target_id, created_at) VALUES (?, NULL, ?, 'admin', 0, ?, ?, ?);",
      [`01HZZ${j.toString().padStart(21, '0')}`, j + 1, action, `target-${j}`, now - j * 1000],
    );
  }
}

describe('GET /api/admin/audit', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns 50 entries by default, most recent first', async () => {
    await seedAudit(h, 200);
    const res = await app.fetch(
      new Request('http://x/api/admin/audit', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { seq: number }[]; total: number };
    expect(body.entries).toHaveLength(50);
    expect(body.total).toBe(200);
    expect(body.entries[0]?.seq).toBe(200);
  });

  it('respects limit + offset', async () => {
    await seedAudit(h, 200);
    const res = await app.fetch(
      new Request('http://x/api/admin/audit?limit=10&offset=20', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = (await res.json()) as { entries: { seq: number }[] };
    expect(body.entries).toHaveLength(10);
    expect(body.entries[0]?.seq).toBe(180);
  });

  it('filters by action', async () => {
    await seedAudit(h, 30, 'forced_pick');
    await seedAudit(h, 20, 'skip', 30);
    const res = await app.fetch(
      new Request('http://x/api/admin/audit?action=skip&limit=100', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = (await res.json()) as { entries: { action: string }[] };
    expect(body.entries.every((e) => e.action === 'skip')).toBe(true);
  });

  it('returns 400 when from > to', async () => {
    const res = await app.fetch(
      new Request(
        'http://x/api/admin/audit?from=2026-12-31T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
        { headers: { Authorization: `Bearer ${await adminJwt()}` } },
      ),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unknown action filter (400)', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/audit?action=launch_missiles', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('caps limit at 500 (returns 400 when above)', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/audit?limit=99999', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

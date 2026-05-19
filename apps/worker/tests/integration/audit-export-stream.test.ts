import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'i'.repeat(64);
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

async function seed(h: TestD1, count: number) {
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    await h.db.run(
      "INSERT INTO audit_log (id, bid_session_id, seq, actor_type, actor_id, action, target_id, reason, created_at) VALUES (?, NULL, ?, 'admin', 0, 'forced_pick', ?, ?, ?);",
      [
        `01HZZ${i.toString().padStart(21, '0')}`,
        i + 1,
        `target-${i}`,
        `reason ${i}`,
        now - i * 1000,
      ],
    );
  }
}

describe('GET /api/admin/audit/export', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('sets text/csv content-type and attachment filename', async () => {
    await seed(h, 5);
    const res = await app.fetch(
      new Request('http://x/api/admin/audit/export?format=csv', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment;\s*filename=/i);
  });

  it('emits a header row + one line per audit entry', async () => {
    await seed(h, 5);
    const res = await app.fetch(
      new Request('http://x/api/admin/audit/export?format=csv', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = await res.text();
    const lines = body.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(6); // 1 header + 5 rows
    expect(lines[0]).toMatch(
      /^id,seq,bid_session_id,actor_type,actor_id,action,target_id,reason,created_at$/,
    );
  });

  it('streams 1500 rows without buffering (paginates internally at 500)', async () => {
    await seed(h, 1500);
    const res = await app.fetch(
      new Request('http://x/api/admin/audit/export?format=csv', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = await res.text();
    const lines = body.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1501);
  });

  it('respects the action filter', async () => {
    await seed(h, 10);
    await h.db.run(
      "INSERT INTO audit_log (id, bid_session_id, seq, actor_type, actor_id, action, target_id, created_at) VALUES ('01HZZSKIPROW00000000000', NULL, 11, 'admin', 0, 'skip', 't', ?);",
      [Date.now()],
    );
    const res = await app.fetch(
      new Request('http://x/api/admin/audit/export?format=csv&action=skip', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = await res.text();
    const lines = body.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // 1 header + 1 skip row
  });

  it('returns 400 on unknown format', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/audit/export?format=xml', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

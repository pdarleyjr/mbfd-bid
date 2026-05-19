import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'b'.repeat(64);

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

describe('GET /api/admin/rule-books', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(`INSERT INTO rule_books (version, effective_year, status) VALUES
      ('2026.1', 2026, 'active'),
      ('2026.2', 2026, 'draft'),
      ('2025.3', 2025, 'archived');`);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('lists all rule books, most recent first by effective_year desc then version desc', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rule_books: { version: string; status: string }[] };
    expect(body.rule_books.map((r) => r.version)).toEqual(['2026.2', '2026.1', '2025.3']);
  });

  it('filters by effective_year', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books?effective_year=2026', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = (await res.json()) as { rule_books: unknown[] };
    expect(body.rule_books).toHaveLength(2);
  });
});

describe('POST /api/admin/rule-books', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(`INSERT INTO rule_books (version, effective_year, status) VALUES
      ('2026.1', 2026, 'active');`);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('creates a fresh draft and returns 201 with the new version', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ effective_year: 2026, notes: 'mid-year corrections' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { version: string; status: string };
    expect(body.version).toBe('2026.2');
    expect(body.status).toBe('draft');
  });

  it('clones position_rules from clone_from when supplied', async () => {
    await h.db.run(`INSERT INTO position_rules
      (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
      VALUES ('2026.1', 'A101', '2026.1', '{}', '{}', '[]');`);
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ effective_year: 2026, clone_from: '2026.1' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { version: string };
    const rows = await h.db.run(
      'SELECT count(*) AS n FROM position_rules WHERE rule_book_version = ?',
      [body.version],
    );
    expect(rows.results[0]?.n).toBe(1);
  });

  it('returns 400 when clone_from references a non-existent version', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ effective_year: 2026, clone_from: '2099.99' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/rule-books/:version/publish', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(`INSERT INTO rule_books (version, effective_year, status) VALUES
      ('2026.1', 2026, 'active'),
      ('2026.2', 2026, 'draft');`);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('atomically demotes the current active to archived and promotes the draft to active', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Chiefs approved 2026.2.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);

    const after = await h.db.run(
      'SELECT version, status FROM rule_books WHERE effective_year = 2026 ORDER BY version',
    );
    expect(after.results).toEqual([
      { version: '2026.1', status: 'archived' },
      { version: '2026.2', status: 'active' },
    ]);
  });

  it('writes an audit log entry with action=rule_book_clone', async () => {
    await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Approved.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const audit = await h.db.run(
      `SELECT action, target_id FROM audit_log WHERE action = 'rule_book_clone'`,
    );
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]?.target_id).toBe('2026.2');
  });

  it('returns 404 when publishing a non-existent version', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books/2099.99/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'no such book' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when the target version is already active', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.1/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'already active' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
  });

  it('returns 401 step_up_required when fresh_auth_at is older than 300s', async () => {
    const stale = await signJwt(
      {
        sub: 0,
        emp: 'admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'B',
        last_name: 'A',
        fresh_auth_at: Math.floor(Date.now() / 1000) - 600,
      },
      KEY,
    );
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stale}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'stale auth' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(401);
  });
});

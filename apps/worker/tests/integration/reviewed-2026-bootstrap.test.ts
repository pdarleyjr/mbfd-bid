import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'r'.repeat(64);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Reviewed',
      last_name: 'Bootstrap',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function bootstrap(h: TestD1): Promise<Response> {
  return app.fetch(
    new Request('http://x/api/admin/positions/bootstrap-reviewed-2026-source', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reason_code: 'rule_override.policy_direction',
        reason: 'Initialize the user-supplied reviewed 2026 source package for configuration.',
      }),
    }),
    { ...h.env, JWT_SIGNING_KEY: KEY },
  );
}

describe('POST /api/admin/positions/bootstrap-reviewed-2026-source', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('atomically creates the reviewed source snapshot and editable 2026.2 draft', async () => {
    const response = await bootstrap(h);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      source_template_version: '2026.1',
      source_rule_book_version: '2026.1',
      draft_rule_book_version: '2026.2',
      source_positions: 233,
      source_rules: 229,
      administrative_positions: 3,
      resumed: false,
    });

    const counts = await h.db.run(
      `SELECT
         (SELECT COUNT(*) FROM position_templates WHERE version = '2026.1') AS templates,
         (SELECT COUNT(*) FROM positions WHERE template_version = '2026.1') AS positions,
         (SELECT COUNT(*) FROM rule_books WHERE version IN ('2026.1', '2026.2')) AS books,
         (SELECT COUNT(*) FROM position_rules WHERE rule_book_version = '2026.1') AS source_rules,
         (SELECT COUNT(*) FROM position_rules WHERE rule_book_version = '2026.2') AS draft_rules,
         (SELECT COUNT(*) FROM rule_book_position_participation
           WHERE rule_book_version = '2026.2'
             AND bid_participation = 'ADMIN_ASSIGNED_NON_BIDDABLE') AS admin_positions,
         (SELECT COUNT(*) FROM audit_log
           WHERE target_kind = 'position_template'
             AND target_id = '2026.1'
             AND action = 'override_rule') AS receipts;`,
    );
    expect(counts.results[0]).toMatchObject({
      templates: 1,
      positions: 233,
      books: 2,
      source_rules: 229,
      draft_rules: 229,
      admin_positions: 3,
      receipts: 1,
    });

    const books = await h.db.run(
      "SELECT version, status FROM rule_books WHERE version IN ('2026.1', '2026.2') ORDER BY version;",
    );
    expect(books.results).toEqual([
      { version: '2026.1', status: 'archived' },
      { version: '2026.2', status: 'draft' },
    ]);
  });

  it('is retry-safe only when the complete reviewed snapshot is already present', async () => {
    expect((await bootstrap(h)).status).toBe(201);

    const retry = await bootstrap(h);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      source_positions: 233,
      source_rules: 229,
      resumed: true,
    });
  });

  it('refuses to infer authority over a partially initialized annual configuration', async () => {
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year, notes) VALUES ('2026.1', 2026, 'partial');",
    );

    const response = await bootstrap(h);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'reviewed_source_state_conflict' });
    const counts = await h.db.run(
      'SELECT (SELECT COUNT(*) FROM positions) AS positions, (SELECT COUNT(*) FROM rule_books) AS books;',
    );
    expect(counts.results[0]).toEqual({ positions: 0, books: 0 });
  });

  it('refuses to bootstrap after the bid year has been designated', async () => {
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('other.1', 2026);",
    );
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('other.1', 2026, 'draft');",
    );
    await h.db.run(
      "UPDATE bid_years SET position_template_version = 'other.1', rule_book_version = 'other.1' WHERE year = 2026;",
    );

    const response = await bootstrap(h);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'bid_year_already_designated' });
  });

  it('feeds the existing reviewed Station 6 reconciliation without a partial policy state', async () => {
    expect((await bootstrap(h)).status).toBe(201);
    const now = Date.UTC(2026, 8, 3, 12, 0, 0);
    await h.db.run(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
          active_from, review_status, created_at, updated_at)
       VALUES
         ('staff-dc-a', 'A/DC/300', 'A Shift', 'Division Chief', 'Division Chief 300',
          'Division Chief', 'DC', '2026-09-03', 'approved', ?, ?),
         ('staff-dc-b', 'B/DC/300', 'B Shift', 'Division Chief', 'Division Chief 300',
          'Division Chief', 'DC', '2026-09-03', 'approved', ?, ?),
         ('staff-dc-c', 'C/DC/300', 'C Shift', 'Division Chief', 'Division Chief 300',
          'Division Chief', 'DC', '2026-09-03', 'approved', ?, ?);`,
      [now, now, now, now, now, now],
    );

    const response = await app.fetch(
      new Request('http://x/api/admin/positions/reconcile-station-six', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason_code: 'rule_override.policy_direction',
          reason: 'Reconcile Station 6 to the reviewed 2026 policy and staffing source.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      template_version: '2026.2',
      rule_book_version: '2026.2',
      positions: 242,
      rules: 238,
      station_six_roles_per_shift: 6,
    });
    const counts = await h.db.run(
      `SELECT
         (SELECT COUNT(*) FROM positions WHERE template_version = '2026.2') AS positions,
         (SELECT COUNT(*) FROM position_rules
           WHERE rule_book_version = '2026.2' AND template_version = '2026.2') AS rules,
         (SELECT COUNT(*) FROM position_staffing_bindings
           WHERE template_version = '2026.2' AND review_status = 'approved') AS bindings,
         (SELECT COUNT(*) FROM rule_book_position_participation
           WHERE rule_book_version = '2026.2' AND template_version = '2026.2') AS participation;`,
    );
    expect(counts.results[0]).toEqual({
      positions: 242,
      rules: 238,
      bindings: 3,
      participation: 3,
    });
  });
});

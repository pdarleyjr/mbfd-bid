import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
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

async function seedValidDraftRule(h: TestD1) {
  await h.db.run(
    `INSERT INTO position_rules
     (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES ('2026.2', 'A101', '2026.1',
       '{"rank":["FF"],"credentials":[],"custom":[]}',
       '{"max":0,"items":[]}',
       '["points","rsc_seniority","rank_seniority"]');`,
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

  it('clones every source rule from clone_from within the create request', async () => {
    await h.db.run(`INSERT INTO position_rules
      (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
      VALUES
        ('2026.1', 'A101', '2026.1', '{}', '{}', '[]'),
        ('2026.1', 'A102', '2026.1', '{}', '{}', '[]');`);
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
    expect(rows.results[0]?.n).toBe(2);
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
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter');`,
    );
    await h.db.run(`INSERT INTO rule_books (version, effective_year, status) VALUES
      -- Insert the draft first: the historical single-UPDATE implementation
      -- could violate the partial active-book index when row order differed.
      ('2026.2', 2026, 'draft'),
      ('2026.1', 2026, 'active');`);
    await seedValidDraftRule(h);
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

  it('rejects a draft with an unsupported custom criterion without changing the active rule book', async () => {
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.2', 'A101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":["pre_bid_pool"]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Attempt to publish an unresolved source rule.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'rule_book_invalid' });
    const after = await h.db.run(
      'SELECT version, status FROM rule_books WHERE effective_year = 2026 ORDER BY version',
    );
    expect(after.results).toEqual([
      { version: '2026.1', status: 'active' },
      { version: '2026.2', status: 'draft' },
    ]);
  });

  it('rejects an empty draft without changing the active rule book', async () => {
    await h.db.run("DELETE FROM position_rules WHERE rule_book_version = '2026.2';");

    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'An empty policy book cannot be approved.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'rule_book_invalid', empty_rule_book: true });
    const after = await h.db.run(
      'SELECT version, status FROM rule_books WHERE effective_year = 2026 ORDER BY version',
    );
    expect(after.results).toEqual([
      { version: '2026.1', status: 'active' },
      { version: '2026.2', status: 'draft' },
    ]);
  });

  it('rejects duplicate position identities in a draft rule book', async () => {
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.2', 'A101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Duplicate rules cannot be approved.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'rule_book_invalid',
      duplicate_position_ids: ['A101'],
    });
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

describe('POL-015 draft rule-book lifecycle', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
    );
    await h.db.run(
      `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES
         ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter'),
         ('A211', '2026.1', 'A', '2', 'Combat', '300', 'DC', 'Division Chief'),
         ('B211', '2026.1', 'B', '2', 'Combat', '300', 'DC', 'Division Chief'),
         ('C211', '2026.1', 'C', '2', 'Combat', '300', 'DC', 'Division Chief');`,
    );
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES
         ('2026.1', 'A101', '2026.1',
           '{"rank":["FF"],"credentials":[],"custom":[]}',
           '{"max":0,"items":[]}',
           '["points","rsc_seniority","rank_seniority"]'),
         ('2026.1', 'A211', '2026.1',
           '{"rank":["DC"],"credentials":[],"custom":["pre_bid_pool"]}',
           '{"max":0,"items":[]}',
           '["points","rsc_seniority","rank_seniority"]'),
         ('2026.1', 'B211', '2026.1',
           '{"rank":["DC"],"credentials":[],"custom":["pre_bid_pool"]}',
           '{"max":0,"items":[]}',
           '["points","rsc_seniority","rank_seniority"]'),
         ('2026.1', 'C211', '2026.1',
           '{"rank":["DC"],"credentials":[],"custom":["pre_bid_pool"]}',
           '{"max":0,"items":[]}',
           '["points","rsc_seniority","rank_seniority"]');`,
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('uses the normal draft lifecycle to correct only A211/B211/C211 and publish complete biddable coverage', async () => {
    const clone = await app.fetch(
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
    expect(clone.status).toBe(201);
    expect(await clone.json()).toMatchObject({ version: '2026.2', status: 'draft' });

    for (const positionId of ['A211', 'B211', 'C211']) {
      const participation = await app.fetch(
        new Request(`http://x/api/admin/rule-books/2026.2/position-participation/${positionId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${await adminJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            template_version: '2026.1',
            bid_participation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
            authoritative_source_ref: 'POL-015-approved-direction',
            reason_code: 'rule_override.policy_direction',
            reason: 'Approved POL-015 administrative staffing correction.',
          }),
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );
      expect(participation.status).toBe(200);

      const rule = await h.db.run(
        'SELECT id FROM position_rules WHERE rule_book_version = ? AND position_id = ?',
        ['2026.2', positionId],
      );
      const deleteRule = await app.fetch(
        new Request(`http://x/api/admin/rules/${rule.results[0]?.id}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${await adminJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            reason_code: 'rule_override.policy_direction',
            reason: 'Remove approved non-biddable staffing position rule.',
          }),
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );
      expect(deleteRule.status).toBe(200);
      expect(await deleteRule.json()).toMatchObject({
        deleted: true,
        rule_book_version: '2026.2',
        position_id: positionId,
      });
    }

    const coverage = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/coverage', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(coverage.status).toBe(200);
    expect(await coverage.json()).toMatchObject({
      rule_book_version: '2026.2',
      valid: true,
      rule_count: 1,
      expected_biddable_position_ids: ['A101'],
      valid_rule_position_ids: ['A101'],
      administratively_assigned_position_ids: ['A211', 'B211', 'C211'],
      missing_biddable_position_ids: [],
      non_biddable_position_ids: [],
      duplicate_position_ids: [],
      unexpected_position_ids: [],
    });

    const diff = await app.fetch(
      new Request(
        'http://x/api/admin/rule-books/2026.2/diff?baseline=2026.1&expected_position_ids=A211,B211,C211',
        {
          headers: { Authorization: `Bearer ${await adminJwt()}` },
        },
      ),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(diff.status).toBe(200);
    expect(await diff.json()).toMatchObject({
      baselineRuleBookVersion: '2026.1',
      candidateRuleBookVersion: '2026.2',
      removedRulePositionIds: ['A211', 'B211', 'C211'],
      addedParticipationPositionIds: ['A211', 'B211', 'C211'],
      changedPositionIds: ['A211', 'B211', 'C211'],
      unexpected_position_ids: [],
      missing_expected_position_ids: [],
    });

    const sourceRules = await h.db.run(
      'SELECT position_id FROM position_rules WHERE rule_book_version = ? ORDER BY position_id',
      ['2026.1'],
    );
    const draftRules = await h.db.run(
      'SELECT position_id FROM position_rules WHERE rule_book_version = ? ORDER BY position_id',
      ['2026.2'],
    );
    expect(sourceRules.results.map((row) => row.position_id)).toEqual([
      'A101',
      'A211',
      'B211',
      'C211',
    ]);
    expect(draftRules.results.map((row) => row.position_id)).toEqual(['A101']);

    const publish = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Publish the verified POL-015 correction.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(publish.status).toBe(200);
    expect(await publish.json()).toMatchObject({
      version: '2026.2',
      status: 'active',
      validation: {
        expected_biddable_position_count: 1,
        valid_bid_rule_count: 1,
        missing_biddable_rules: 0,
        non_biddable_rules_present: 0,
        duplicate_rules: 0,
        unexpected_rule_differences: 0,
      },
    });
  });

  it('rejects an active-book participation mutation without creating an override', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.1/position-participation/A211', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template_version: '2026.1',
          bid_participation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
          authoritative_source_ref: 'POL-015-approved-direction',
          reason_code: 'rule_override.policy_direction',
          reason: 'This must not alter the active rule book.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'rule_book_immutable', status: 'active' });
    const overrides = await h.db.run(
      'SELECT position_id FROM rule_book_position_participation WHERE rule_book_version = ?',
      ['2026.1'],
    );
    expect(overrides.results).toEqual([]);
    const activeBook = await h.db.run('SELECT status, revision FROM rule_books WHERE version = ?', [
      '2026.1',
    ]);
    expect(activeBook.results).toEqual([{ status: 'active', revision: 0 }]);
  });
});

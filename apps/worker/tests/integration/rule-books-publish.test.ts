import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'b'.repeat(64);
const SYNTHETIC_NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const SYNTHETIC_HASH = 'a'.repeat(64);

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

async function designateSyntheticDraftForPublication(h: TestD1): Promise<void> {
  await h.db.run(
    `INSERT INTO bid_years
       (year, status, position_template_version, rule_book_version, config_json, configuration_revision)
     VALUES
       (2026, 'configuring', '2026.1', '2026.2',
        '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-01-01"}', 0)
     ON CONFLICT(year) DO UPDATE SET
       status = excluded.status,
       position_template_version = excluded.position_template_version,
       rule_book_version = excluded.rule_book_version,
       config_json = excluded.config_json,
       configuration_revision = excluded.configuration_revision;`,
  );
}

/** Creates one fully synthetic, committed source-backed staffing baseline. */
async function seedCommittedSyntheticTeleStaffBaseline(h: TestD1): Promise<void> {
  await h.db.run(
    `INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
        is_probationary, created_at, updated_at)
     VALUES
       (9901, 'synthetic-publish-member', 'Synthetic', 'Publisher', 'FF', 'FF', 1, 0, ?, ?);`,
    [SYNTHETIC_NOW, SYNTHETIC_NOW],
  );
  await h.db.run(
    `INSERT INTO staffing_positions
       (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
        active_from, review_status, created_at, updated_at)
     VALUES
       ('synthetic-publish-slot', 'SYNTHETIC/2026/A101', 'A', '1', 'Engine 1', 'Firefighter',
        'FF', '2026-01-01', 'approved', ?, ?);`,
    [SYNTHETIC_NOW, SYNTHETIC_NOW],
  );
  await h.db.run(
    `INSERT INTO staffing_position_source_mappings
       (id, staffing_position_id, source_system, source_locator, source_signature,
        source_version, source_hash, effective_from, created_at)
     VALUES
        ('synthetic-publish-mapping', 'synthetic-publish-slot', 'telestaff',
         '{"v":1,"shift":"A Shift","division":"Suppression/Rescue","station":"1","unit":"Engine 1","position":"Firefighter"}',
        ?, 'synthetic-v1', ?, '2026-01-01', ?);`,
    [SYNTHETIC_HASH, SYNTHETIC_HASH, SYNTHETIC_NOW],
  );
  await h.db.run(
    `INSERT INTO assignment_imports
        (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
         status, input_row_count, normalized_data_row_count, unique_employee_count,
         report_row_count, structural_row_count, created_at)
      VALUES ('synthetic-publish-import', 'telestaff', 'synthetic-v1', ?,
        'TELSTAFF_ASSIGNMENTS_HTML_V1', 'telestaff-assignments-html@1',
        'official', 'staged', 1, 1, 1, 1, 0, ?);`,
    [SYNTHETIC_HASH, SYNTHETIC_NOW],
  );
  await h.db.run(
    `INSERT INTO assignment_import_rows
       (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
        resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology,
        disposition, reconciliation_classification, review_status, created_at)
     VALUES
       ('synthetic-publish-row', 'synthetic-publish-import', 1, ?, ?, 9901,
          'synthetic-publish-mapping',
          '{"v":1,"shift":"A Shift","division":"Suppression/Rescue","station":"1","unit":"Engine 1","position":"Firefighter"}',
          'unchanged', 'UNCHANGED', 'not_required', ?);`,
    ['b'.repeat(64), 'c'.repeat(64), SYNTHETIC_NOW],
  );
  await h.db.run(
    "UPDATE assignment_imports SET status = 'reviewed' WHERE id = 'synthetic-publish-import';",
  );
  await h.db.run(
    `UPDATE assignment_imports
        SET status = 'approved', approved_at = ?, approved_by_member_id = 9901
      WHERE id = 'synthetic-publish-import';`,
    [SYNTHETIC_NOW],
  );
  await h.db.run(
    "UPDATE assignment_imports SET status = 'committed', committed_at = ? WHERE id = 'synthetic-publish-import';",
    [SYNTHETIC_NOW],
  );
  await h.db.run(
    `INSERT INTO assignment_observations
       (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id,
        staffing_position_source_mapping_id, normalized_source_topology, observed_at, created_at)
     VALUES
       ('synthetic-publish-observation', 'synthetic-publish-import', 'synthetic-publish-row', 9901,
        'synthetic-publish-slot', 'synthetic-publish-mapping',
        '{"v":1,"shift":"A Shift","division":"Suppression/Rescue","station":"1","unit":"Engine 1","position":"Firefighter"}', ?, ?);`,
    [SYNTHETIC_NOW, SYNTHETIC_NOW],
  );
  await h.db.run(
    `INSERT INTO member_assignments
       (id, member_id, staffing_position_id, origin_type, origin_ref, source_observation_id,
        status, effective_from, created_at, updated_at)
     VALUES
       ('synthetic-publish-assignment', 9901, 'synthetic-publish-slot', 'TELESTAFF_IMPORT',
        'synthetic-publish-import', 'synthetic-publish-observation', 'active', '2026-01-01', ?, ?);`,
    [SYNTHETIC_NOW, SYNTHETIC_NOW],
  );
  await h.db.run(
    `INSERT INTO bid_year_staffing_baselines
       (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
        acceptance_reason, created_at)
     VALUES ('synthetic-publish-baseline', 2026, 'synthetic-publish-import', 'accepted',
       ?, 9901, 'Synthetic source baseline accepted for test only.', ?);`,
    [SYNTHETIC_NOW, SYNTHETIC_NOW],
  );
}

async function seedPublishableSyntheticPreflight(h: TestD1): Promise<void> {
  await designateSyntheticDraftForPublication(h);
  await seedCommittedSyntheticTeleStaffBaseline(h);
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
    const reason = 'Create a reviewed mid-year policy correction draft.';
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          effective_year: 2026,
          notes: 'mid-year corrections',
          reason,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { version: string; status: string };
    expect(body.version).toBe('2026.2');
    expect(body.status).toBe('draft');
    expect(
      await h.db.run(
        `SELECT action, target_id, reason, before_state, after_state
         FROM audit_log
         WHERE action = 'rule_book_clone' AND target_id = '2026.2'`,
      ),
    ).toMatchObject({
      results: [
        {
          action: 'rule_book_clone',
          target_id: '2026.2',
          reason,
          before_state: JSON.stringify({ clone_from: null, source_rule_book: null }),
          after_state: JSON.stringify({
            version: '2026.2',
            effective_year: 2026,
            status: 'draft',
            clone_from: null,
            notes: 'mid-year corrections',
          }),
        },
      ],
    });
  });

  it('rejects a creation request without an operator reason before inserting a draft', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ effective_year: 2026, notes: 'No reason was supplied.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(400);
    expect(await h.db.run('SELECT version FROM rule_books ORDER BY version')).toMatchObject({
      results: [{ version: '2026.1' }],
    });
    expect(
      await h.db.run("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'rule_book_clone'"),
    ).toMatchObject({ results: [{ n: 0 }] });
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
        body: JSON.stringify({
          effective_year: 2026,
          clone_from: '2026.1',
          reason: 'Clone the established policy into a reviewed draft.',
        }),
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

  it('records an atomic, actor-attributed audit receipt when creating a draft clone', async () => {
    const reason = 'Clone the established policy into a reviewed annual draft.';
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          effective_year: 2026,
          clone_from: '2026.1',
          notes: 'Synthetic clone audit proof.',
          reason,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(201);
    const audit = await h.db.run(
      `SELECT action, actor_type, actor_id, target_kind, target_id, reason,
              before_state, after_state, created_at
       FROM audit_log
       WHERE action = 'rule_book_clone' AND target_id = '2026.2'`,
    );
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({
      action: 'rule_book_clone',
      actor_type: 'admin',
      actor_id: 0,
      target_kind: 'rule_book',
      target_id: '2026.2',
      reason,
    });
    expect(Number(audit.results[0]?.created_at)).toBeGreaterThan(0);
    expect(JSON.parse(String(audit.results[0]?.before_state))).toMatchObject({
      clone_from: '2026.1',
      source_rule_book: { version: '2026.1', status: 'active' },
    });
    expect(JSON.parse(String(audit.results[0]?.after_state))).toMatchObject({
      version: '2026.2',
      effective_year: 2026,
      status: 'draft',
      clone_from: '2026.1',
      notes: 'Synthetic clone audit proof.',
    });
  });

  it('returns 400 when clone_from references a non-existent version', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          effective_year: 2026,
          clone_from: '2099.99',
          reason: 'Attempt to clone an unknown policy must be rejected.',
        }),
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
    await seedPublishableSyntheticPreflight(h);
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

  it('rolls back the rule-book publication when its authoritative audit receipt fails', async () => {
    // The publish batch is archive, promote, then audit. A failed audit must
    // never leave an active policy change without its durable audit receipt.
    h.failNextBatchAt(2);

    const response = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Inject an audit-receipt failure.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(500);
    expect(
      (
        await h.db.run(
          'SELECT version, status FROM rule_books WHERE effective_year = 2026 ORDER BY version',
        )
      ).results,
    ).toEqual([
      { version: '2026.1', status: 'active' },
      { version: '2026.2', status: 'draft' },
    ]);
    expect(
      (await h.db.run("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'rule_book_clone'"))
        .results,
    ).toEqual([{ n: 0 }]);
  });

  it('keeps the draft unpublished if the exact accepted baseline is superseded after preflight', async () => {
    const d1 = h.env.DB;
    const originalBatch = d1.batch.bind(d1);
    let superseded = false;
    d1.batch = async (statements) => {
      if (!superseded) {
        superseded = true;
        h.sqlite
          .prepare(
            `UPDATE bid_year_staffing_baselines
             SET status = 'superseded', superseded_at = ?, superseded_by_member_id = ?,
                 supersession_reason = ?
             WHERE id = 'synthetic-publish-baseline'`,
          )
          .run(SYNTHETIC_NOW + 1, 9901, 'Synthetic concurrent baseline replacement.');
      }
      return originalBatch(statements);
    };

    const response = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'A superseded baseline cannot authorize publication.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'rule_book_status_changed' });
    expect(
      (
        await h.db.run(
          'SELECT version, status FROM rule_books WHERE effective_year = 2026 ORDER BY version',
        )
      ).results,
    ).toEqual([
      { version: '2026.1', status: 'active' },
      { version: '2026.2', status: 'draft' },
    ]);
  });

  it('keeps the draft unpublished if an accepted canonical assignment ends after preflight', async () => {
    const d1 = h.env.DB;
    const originalBatch = d1.batch.bind(d1);
    let ended = false;
    d1.batch = async (statements) => {
      if (!ended) {
        ended = true;
        h.sqlite
          .prepare(
            `UPDATE member_assignments
             SET status = 'ended', effective_to = '2026-08-28'
             WHERE source_observation_id = 'synthetic-publish-observation'`,
          )
          .run();
      }
      return originalBatch(statements);
    };

    const response = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'A stale canonical projection cannot authorize publication.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'rule_book_status_changed' });
    expect(
      (
        await h.db.run(
          'SELECT version, status FROM rule_books WHERE effective_year = 2026 ORDER BY version',
        )
      ).results,
    ).toEqual([
      { version: '2026.1', status: 'active' },
      { version: '2026.2', status: 'draft' },
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

  it('keeps the POL-015 correction draft unpublished without authoritative staffing baseline and bindings', async () => {
    const clone = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          effective_year: 2026,
          clone_from: '2026.1',
          reason: 'Create a synthetic POL-015 correction draft for review.',
        }),
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

    // The draft is explicitly designated, so publication reaches the staffing
    // preflight rather than silently relying on whichever book is active.
    // Do not seed a baseline or DC bindings here: this is the negative proof.
    await designateSyntheticDraftForPublication(h);

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
    expect(publish.status).toBe(409);
    expect(await publish.json()).toMatchObject({
      error: 'rule_book_publication_blocked',
      blocker: 'authoritative_staffing_baseline_required',
      position_ids: [],
      baseline: {
        status: 'BLOCKED',
        blockingCodes: ['NO_ACCEPTED_TELESTAFF_BASELINE'],
      },
    });
    const books = await h.db.run(
      'SELECT version, status FROM rule_books WHERE effective_year = 2026 ORDER BY version',
    );
    expect(books.results).toEqual([
      { version: '2026.1', status: 'active' },
      { version: '2026.2', status: 'draft' },
    ]);
  });

  it('rolls back a participation override when its authoritative audit receipt fails', async () => {
    const clone = await app.fetch(
      new Request('http://x/api/admin/rule-books', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          effective_year: 2026,
          clone_from: '2026.1',
          reason: 'Create a synthetic draft for an audit-failure proof.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(clone.status).toBe(201);

    // The override batch is participation, revision, then audit.
    h.failNextBatchAt(2);
    const response = await app.fetch(
      new Request('http://x/api/admin/rule-books/2026.2/position-participation/A211', {
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
          reason: 'Inject an override audit-receipt failure.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(500);
    expect(
      (
        await h.db.run(
          'SELECT position_id FROM rule_book_position_participation WHERE rule_book_version = ?',
          ['2026.2'],
        )
      ).results,
    ).toEqual([]);
    expect(
      (await h.db.run("SELECT revision FROM rule_books WHERE version = '2026.2'")).results,
    ).toEqual([{ revision: 0 }]);
    expect(
      (
        await h.db.run(
          "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'override_rule' AND target_id = '2026.2:A211'",
        )
      ).results,
    ).toEqual([{ n: 0 }]);
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

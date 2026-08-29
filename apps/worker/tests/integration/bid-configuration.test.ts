import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { seedAuthoritativeBaseline } from './helpers/authoritative-staffing-baseline.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'g'.repeat(64);
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

async function freshAdmin(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function adminRequest(h: TestD1, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await freshAdmin()}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  return app.fetch(new Request(`http://x${path}`, { ...init, headers }), {
    ...h.env,
    JWT_SIGNING_KEY: KEY,
  });
}

async function seedConfigFixture(h: TestD1): Promise<void> {
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2027, 'configuring');");
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2027.1', 2027);",
  );
  await h.db.run(
    `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES ('A101', '2027.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter');`,
  );
  await h.db.run(
    `INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
        is_probationary, employment_status, employment_status_effective_on, created_at, updated_at)
     VALUES (701, 'synthetic-701', 'Synthetic', 'Member', 'FF', 'FF', 1, 0,
        'active', '2027-01-01', ${NOW}, ${NOW});`,
  );
  await h.db.run(
    `INSERT INTO rule_books (version, effective_year, status)
     VALUES ('2027.1', 2027, 'active'), ('2027.2', 2027, 'draft');`,
  );
  await h.db.run(
    `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria,
        points_preference, tie_break_chain)
     VALUES
       ('2027.1', 'A101', '2027.1',
        '{"rank":["LT"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]'),
       ('2027.2', 'A101', '2027.1',
        '{"rank":["FF"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]');`,
  );
}

/** Creates a fully synthetic, committed source-backed staffing baseline. */
async function seedCommittedTeleStaffBaseline(h: TestD1): Promise<void> {
  const hash = 'a'.repeat(64);
  const now = NOW;
  await h.db.run(
    `INSERT INTO staffing_positions
       (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
        active_from, review_status, created_at, updated_at)
     VALUES
       ('synthetic-slot-701', 'SYNTHETIC/2027/A101', 'A', '1', 'Engine 1', 'Firefighter', 'FF',
        '2027-01-01', 'approved', ?, ?);`,
    [now, now],
  );
  await h.db.run(
    `INSERT INTO staffing_position_source_mappings
       (id, staffing_position_id, source_system, source_locator, source_signature,
        source_version, source_hash, effective_from, created_at)
     VALUES
        ('synthetic-mapping-701', 'synthetic-slot-701', 'telestaff',
         '{"v":1,"shift":"A Shift","division":"Suppression/Rescue","station":"1","unit":"Engine 1","position":"Firefighter"}',
        ?, 'synthetic-v1', ?, '2027-01-01', ?);`,
    [hash, hash, now],
  );
  await h.db.run(
    `INSERT INTO assignment_imports
        (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
         status, input_row_count, normalized_data_row_count, unique_employee_count,
         report_row_count, structural_row_count, created_at)
      VALUES ('synthetic-import-701', 'telestaff', 'synthetic-v1', ?,
        'TELSTAFF_ASSIGNMENTS_HTML_V1', 'telestaff-assignments-html@1',
        'official', 'staged', 1, 1, 1, 1, 0, ?);`,
    [hash, now],
  );
  await h.db.run(
    `INSERT INTO assignment_import_rows
       (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
        resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology,
        disposition, reconciliation_classification, review_status, created_at)
     VALUES
       ('synthetic-row-701', 'synthetic-import-701', 1, ?, ?, 701, 'synthetic-mapping-701',
         '{"v":1,"shift":"A Shift","division":"Suppression/Rescue","station":"1","unit":"Engine 1","position":"Firefighter"}',
         'unchanged', 'UNCHANGED', 'not_required', ?);`,
    ['b'.repeat(64), 'c'.repeat(64), now],
  );
  await h.db.run(
    "UPDATE assignment_imports SET status = 'reviewed' WHERE id = 'synthetic-import-701';",
  );
  await h.db.run(
    `UPDATE assignment_imports
        SET status = 'approved', approved_at = ?, approved_by_member_id = 701
      WHERE id = 'synthetic-import-701';`,
    [now],
  );
  await h.db.run(
    "UPDATE assignment_imports SET status = 'committed', committed_at = ? WHERE id = 'synthetic-import-701';",
    [now],
  );
  await h.db.run(
    `INSERT INTO assignment_observations
       (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id,
        staffing_position_source_mapping_id, normalized_source_topology, observed_at, created_at)
     VALUES
       ('synthetic-observation-701', 'synthetic-import-701', 'synthetic-row-701', 701,
        'synthetic-slot-701', 'synthetic-mapping-701',
        '{"v":1,"shift":"A Shift","division":"Suppression/Rescue","station":"1","unit":"Engine 1","position":"Firefighter"}', ?, ?);`,
    [now, now],
  );
  await h.db.run(
    `INSERT INTO member_assignments
       (id, member_id, staffing_position_id, origin_type, origin_ref, source_observation_id,
        status, effective_from, created_at, updated_at)
     VALUES
       ('synthetic-assignment-701', 701, 'synthetic-slot-701', 'TELESTAFF_IMPORT',
        'synthetic-import-701', 'synthetic-observation-701', 'active', '2027-01-01', ?, ?);`,
    [now, now],
  );
  await h.db.run(
    `INSERT INTO bid_year_staffing_baselines
       (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
        acceptance_reason, created_at)
     VALUES ('synthetic-import-701-acceptance', 2027, 'synthetic-import-701', 'accepted',
       ?, 701, 'Synthetic source baseline accepted for test only.', ?);`,
    [now, now],
  );
}

async function designateDraft(
  h: TestD1,
  expectedRevision = 0,
  settings: {
    expected_duration_days: number;
    turn_timer_seconds: number;
    credential_evaluation_on?: string;
  } = {
    expected_duration_days: 2,
    turn_timer_seconds: 180,
    credential_evaluation_on: '2027-01-15',
  },
): Promise<Response> {
  return adminRequest(h, '/api/admin/bid-configuration/2027', {
    method: 'PUT',
    body: JSON.stringify({
      rule_book_version: '2027.2',
      expected_configuration_revision: expectedRevision,
      settings,
      reason: 'Select synthetic annual draft configuration.',
    }),
  });
}

describe('annual bid configuration selection', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await seedConfigFixture(h);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('does not fall back to an active rule book when a year has no designated configuration', async () => {
    const response = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: true }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'bid_configuration_unconfigured',
    });
  });

  it('selects a valid draft with optimistic concurrency and writes an audit record', async () => {
    const selected = await designateDraft(h);

    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({
      configuration: {
        bidYear: 2027,
        ruleBookVersion: '2027.2',
        positionTemplateVersion: '2027.1',
        configurationRevision: 1,
        ruleBookRevision: 0,
        settings: {
          v: 2,
          credentialEvaluationOn: '2027-01-15',
        },
        lifecycle: 'DRAFT',
      },
    });
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS count FROM audit_log WHERE action = 'bid_configuration_set' AND target_id = '2027'",
        )
      ).results[0]?.count,
    ).toBe(1);

    const stale = await designateDraft(h, 0);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'bid_configuration_changed' });
  });

  it('rejects a new designation that omits the credential evaluation date instead of treating V1 settings as compliant', async () => {
    const selected = await adminRequest(h, '/api/admin/bid-configuration/2027', {
      method: 'PUT',
      body: JSON.stringify({
        rule_book_version: '2027.2',
        expected_configuration_revision: 0,
        settings: {
          expected_duration_days: 2,
          turn_timer_seconds: 180,
        },
        reason: 'Attempt an incomplete synthetic configuration.',
      }),
    });

    expect(selected.status).toBe(400);
    expect((await h.db.run('SELECT config_json FROM bid_years WHERE year = 2027')).results).toEqual(
      [{ config_json: null }],
    );
  });

  it('keeps a legacy V1 configuration readable for repair but fails closed for new sessions', async () => {
    await h.db.run(
      `UPDATE bid_years
          SET rule_book_version = '2027.2',
              position_template_version = '2027.1',
              config_json = '{"v":1,"expectedDurationDays":2,"turnTimerSeconds":180}'
        WHERE year = 2027`,
    );

    const read = await adminRequest(h, '/api/admin/bid-configuration/2027');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      configuration: {
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
        lifecycle: 'LEGACY_EVALUATION_DATE_REQUIRED',
      },
    });

    const session = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: true }),
    });
    expect(session.status).toBe(409);
    expect(await session.json()).toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'bid_configuration_credential_evaluation_date_required',
    });
  });

  it('rejects a session when the designated configuration changes at the creation boundary', async () => {
    expect((await designateDraft(h)).status).toBe(200);
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    let changedConfiguration = false;
    const env = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      DB: {
        ...h.env.DB,
        batch: async (statements: D1PreparedStatement[]) => {
          if (!changedConfiguration) {
            changedConfiguration = true;
            h.sqlite
              .prepare(
                `UPDATE bid_years
                    SET config_json = ?, configuration_revision = configuration_revision + 1
                  WHERE year = 2027`,
              )
              .run(JSON.stringify({ v: 1, expectedDurationDays: 2, turnTimerSeconds: 240 }));
          }
          return originalBatch(statements);
        },
      },
    };

    const response = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bid_year: 2027, is_mock: true }),
      }),
      env,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'bid_configuration_changed' });
    expect((await h.db.run('SELECT id FROM bid_sessions')).results).toEqual([]);
    expect(
      (await h.db.run('SELECT bid_session_id FROM bid_session_policy_snapshots')).results,
    ).toEqual([]);
  });

  it('uses the designated draft for a mock and records the exact mutable-rule revision', async () => {
    expect((await designateDraft(h)).status).toBe(200);
    const assignmentsBefore = await h.db.run('SELECT id FROM member_assignments ORDER BY id');

    const created = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: true }),
    });

    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      id: string;
      is_mock: boolean;
      rule_book_version: string;
      rule_book_revision: number;
    };
    expect(body).toMatchObject({
      is_mock: true,
      rule_book_version: '2027.2',
      rule_book_revision: 0,
    });
    expect((await h.db.run('SELECT id FROM member_assignments ORDER BY id')).results).toEqual(
      assignmentsBefore.results,
    );

    const snapshot = await adminRequest(h, `/api/admin/bid-session/${body.id}/policy-snapshot`);
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      snapshot: {
        ruleBookVersion: '2027.2',
        ruleBookRevision: 0,
        credentialEvaluationOn: '2027-01-15',
        settings: { v: 2, credentialEvaluationOn: '2027-01-15' },
      },
    });
  });

  it('keeps Mock A immutable when the same draft configuration and rules evolve for Mock B', async () => {
    expect((await designateDraft(h)).status).toBe(200);
    const canonicalAssignmentsBefore = await h.db.run(
      'SELECT id, member_id, staffing_position_id, status FROM member_assignments ORDER BY id',
    );
    const portalQueueBefore = await h.db.run(
      'SELECT id, bid_id, status FROM portal_writeback_queue ORDER BY id',
    );

    const firstMock = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: true }),
    });
    expect(firstMock.status).toBe(201);
    const { id: firstId } = (await firstMock.json()) as { id: string };

    const firstSnapshotBeforeResponse = await adminRequest(
      h,
      `/api/admin/bid-session/${firstId}/policy-snapshot`,
    );
    expect(firstSnapshotBeforeResponse.status).toBe(200);
    const firstSnapshotBefore = (await firstSnapshotBeforeResponse.json()) as {
      snapshot: {
        v: 3;
        configurationRevision: number;
        ruleBookRevision: number;
        settings: { expectedDurationDays: number; turnTimerSeconds: number };
        ruleBookMaterial: {
          v: 1;
          rules: Array<{
            ruleBookVersion: string;
            positionId: string;
            templateVersion: string;
            requiredCriteriaJson: string;
            pointsPreferenceJson: string;
            tieBreakChainJson: string;
          }>;
          positions: Array<{
            id: string;
            templateVersion: string;
            bidParticipation: string;
            isExcludedFromCount: boolean;
          }>;
        };
        members: Array<{
          memberId: number;
          rank: string;
          isProbationary: boolean;
          credentialNames: string[];
        }>;
      };
    };
    expect(firstSnapshotBefore.snapshot).toMatchObject({
      v: 3,
      configurationRevision: 1,
      ruleBookRevision: 0,
      settings: { expectedDurationDays: 2, turnTimerSeconds: 180 },
      ruleBookMaterial: {
        v: 1,
        rules: [
          {
            ruleBookVersion: '2027.2',
            positionId: 'A101',
            templateVersion: '2027.1',
            requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
            pointsPreferenceJson: '{"max":0,"items":[]}',
            tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
          },
        ],
        positions: [
          {
            id: 'A101',
            templateVersion: '2027.1',
            bidParticipation: 'BIDDABLE',
            isExcludedFromCount: false,
          },
        ],
      },
      members: [
        {
          memberId: 701,
          rank: 'FF',
          isProbationary: false,
          credentialNames: [],
        },
      ],
    });

    const firstStart = await adminRequest(h, `/api/admin/bid-session/${firstId}/start`, {
      method: 'POST',
    });
    expect(firstStart.status).toBe(200);

    // Advance the same designated draft. The configuration endpoint exercises
    // the annual optimistic-concurrency boundary; the rule update is a
    // synthetic in-memory representation of an approved draft-rule edit.
    const revised = await designateDraft(h, 1, {
      expected_duration_days: 3,
      turn_timer_seconds: 240,
      credential_evaluation_on: '2027-01-15',
    });
    expect(revised.status).toBe(200);
    await h.db.run(
      `UPDATE position_rules
          SET required_criteria = '{"rank":["LT"],"credentials":[],"custom":[]}'
        WHERE rule_book_version = '2027.2' AND position_id = 'A101';`,
    );
    await h.db.run("UPDATE rule_books SET revision = revision + 1 WHERE version = '2027.2';");
    // Simulate a later canonical roster correction after Mock A is already
    // started. Mock A must use its frozen FF eligibility input; Mock B must
    // capture the then-current LT input alongside the amended LT-only rule.
    await h.db.run("UPDATE members SET rank = 'LT' WHERE id = 701;");
    const canonicalRosterAfterSourceEdit = await h.db.run(
      'SELECT id, rank, is_probationary FROM members ORDER BY id',
    );

    // A completed Mock A must remain inspectable exactly as it was captured.
    // In particular, it cannot continuously resolve the mutable draft's new
    // annual settings or LT-only rule.
    const firstSnapshotAfterResponse = await adminRequest(
      h,
      `/api/admin/bid-session/${firstId}/policy-snapshot`,
    );
    expect(firstSnapshotAfterResponse.status).toBe(200);
    expect(await firstSnapshotAfterResponse.json()).toEqual(firstSnapshotBefore);

    const firstPick = await adminRequest(h, `/api/admin/rehearsal/${firstId}/manual-pick`, {
      method: 'POST',
      body: JSON.stringify({
        member_id: 701,
        position_id: 'A101',
        reason: 'Synthetic revision-one mock pick.',
      }),
    });
    expect(firstPick.status).toBe(201);

    const secondMock = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: true }),
    });
    expect(secondMock.status).toBe(201);
    const { id: secondId } = (await secondMock.json()) as { id: string };

    const secondStart = await adminRequest(h, `/api/admin/bid-session/${secondId}/start`, {
      method: 'POST',
    });
    expect(secondStart.status).toBe(200);

    const secondSnapshot = await adminRequest(
      h,
      `/api/admin/bid-session/${secondId}/policy-snapshot`,
    );
    expect(secondSnapshot.status).toBe(200);
    expect(await secondSnapshot.json()).toMatchObject({
      snapshot: {
        v: 3,
        ruleBookVersion: '2027.2',
        ruleBookRevision: 1,
        configurationRevision: 2,
        credentialEvaluationOn: '2027-01-15',
        settings: {
          v: 2,
          expectedDurationDays: 3,
          turnTimerSeconds: 240,
          credentialEvaluationOn: '2027-01-15',
        },
        ruleBookMaterial: {
          v: 1,
          rules: [
            {
              ruleBookVersion: '2027.2',
              positionId: 'A101',
              templateVersion: '2027.1',
              requiredCriteriaJson: '{"rank":["LT"],"credentials":[],"custom":[]}',
              pointsPreferenceJson: '{"max":0,"items":[]}',
              tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
            },
          ],
          positions: [
            {
              id: 'A101',
              templateVersion: '2027.1',
              bidParticipation: 'BIDDABLE',
              isExcludedFromCount: false,
            },
          ],
        },
        members: [
          {
            memberId: 701,
            rank: 'LT',
            isProbationary: false,
            credentialNames: [],
          },
        ],
      },
    });

    // Mock B is independently driven by its amended LT-only rule and newly
    // captured member rank. This makes the R1/R2 distinction behavioral rather
    // than merely a provenance label.
    const secondPick = await adminRequest(h, `/api/admin/rehearsal/${secondId}/manual-pick`, {
      method: 'POST',
      body: JSON.stringify({
        member_id: 701,
        position_id: 'A101',
        reason: 'Synthetic revision-two mock pick.',
      }),
    });
    expect(secondPick.status).toBe(201);

    const auditRows = (
      await h.db.run(
        `SELECT bid_session_id, action
         FROM audit_log
        WHERE bid_session_id IN (?, ?)
        ORDER BY bid_session_id, seq`,
        [firstId, secondId],
      )
    ).results as Array<{ bid_session_id: string; action: string }>;
    expect(
      auditRows.some((row) => row.bid_session_id === firstId && row.action === 'session_start'),
    ).toBe(true);
    expect(
      auditRows.some(
        (row) => row.bid_session_id === firstId && row.action === 'admin_bid_for_member',
      ),
    ).toBe(true);
    expect(
      auditRows.some((row) => row.bid_session_id === secondId && row.action === 'session_start'),
    ).toBe(true);
    expect(
      auditRows.some(
        (row) => row.bid_session_id === secondId && row.action === 'admin_bid_for_member',
      ),
    ).toBe(true);

    // Mock bids are session-local rehearsal data. They may neither alter the
    // canonical roster nor enqueue portal publication work.
    expect(
      (
        await h.db.run(
          'SELECT id, member_id, staffing_position_id, status FROM member_assignments ORDER BY id',
        )
      ).results,
    ).toEqual(canonicalAssignmentsBefore.results);
    expect(
      (await h.db.run('SELECT id, rank, is_probationary FROM members ORDER BY id')).results,
    ).toEqual(canonicalRosterAfterSourceEdit.results);
    expect(
      (await h.db.run('SELECT id, bid_id, status FROM portal_writeback_queue ORDER BY id')).results,
    ).toEqual(portalQueueBefore.results);
  });

  it('does not permit a configured session to override its annual timer settings', async () => {
    expect((await designateDraft(h)).status).toBe(200);
    const created = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: true }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const override = await adminRequest(h, `/api/admin/bid-session/${id}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ turn_timer_seconds: 240 }),
    });
    expect(override.status).toBe(409);
    expect(await override.json()).toMatchObject({
      error: 'session_configuration_managed_by_bid_year',
      configuration_revision: 1,
      settings: { expected_duration_days: 2, turn_timer_seconds: 180 },
    });
    expect(
      (await h.db.run('SELECT turn_timer_seconds FROM bid_sessions WHERE id = ?', [id])).results,
    ).toEqual([{ turn_timer_seconds: 180 }]);
  });

  it('fails closed when a legacy snapshot lacks immutable material', async () => {
    const id = 'legacy-draft-without-revision';
    await h.db.run(
      `INSERT INTO bid_sessions
         (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
       VALUES (?, 2027, ?, 'config', 180, 2, 0, 1);`,
      [id, NOW],
    );
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, snapshot_json, captured_at)
       VALUES (?, '2027.2', '2027.1', ?, ?);`,
      [
        id,
        JSON.stringify({
          v: 1,
          ruleBookVersion: '2027.2',
          positionTemplateVersion: '2027.1',
          capturedAtMs: NOW,
          members: [],
        }),
        NOW,
      ],
    );

    const start = await adminRequest(h, `/api/admin/bid-session/${id}/start`, { method: 'POST' });
    expect(start.status).toBe(409);
    expect(await start.json()).toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_material_missing',
    });
  });

  it('blocks a designated draft from publication until a committed staffing baseline exists', async () => {
    expect((await designateDraft(h)).status).toBe(200);

    const publish = await adminRequest(h, '/api/admin/rule-books/2027.2/publish', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Attempt a synthetic freeze without staffing evidence.' }),
    });

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
    expect(
      (await h.db.run("SELECT status FROM rule_books WHERE version = '2027.2'")).results,
    ).toEqual([{ status: 'draft' }]);
  });

  it('blocks a partial multi-row source baseline at publication and keeps the draft/live gates closed', async () => {
    expect((await designateDraft(h)).status).toBe(200);
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'partial-publication-baseline',
      rows: [
        {
          sourceRowNumber: 1,
          normalizedTopology: 'synthetic/partial-one',
          materializeObservation: true,
        },
        {
          sourceRowNumber: 2,
          normalizedTopology: 'synthetic/partial-two',
          materializeObservation: false,
        },
      ],
      accept: false,
    });

    const publish = await adminRequest(h, '/api/admin/rule-books/2027.2/publish', {
      method: 'POST',
      body: JSON.stringify({ reason: 'A partial source manifest must not freeze the draft.' }),
    });
    expect(publish.status).toBe(409);
    expect(await publish.json()).toMatchObject({
      error: 'rule_book_publication_blocked',
      blocker: 'authoritative_staffing_baseline_required',
      baseline: {
        status: 'BLOCKED',
        blockingCodes: ['NO_ACCEPTED_TELESTAFF_BASELINE'],
      },
    });
    expect(
      (await h.db.run("SELECT status FROM rule_books WHERE version = '2027.2'")).results,
    ).toEqual([{ status: 'draft' }]);

    const live = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: false }),
    });
    expect(live.status).toBe(409);
    expect(await live.json()).toMatchObject({ policy_error: 'bid_configuration_frozen_required' });
  });

  it('rejects publication when the designated configuration changes at the freeze boundary', async () => {
    expect((await designateDraft(h)).status).toBe(200);
    await seedCommittedTeleStaffBaseline(h);
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    let changedConfiguration = false;
    const env = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      DB: {
        ...h.env.DB,
        batch: async (statements: D1PreparedStatement[]) => {
          if (!changedConfiguration) {
            changedConfiguration = true;
            h.sqlite
              .prepare(
                `UPDATE bid_years
                    SET config_json = ?, configuration_revision = configuration_revision + 1
                  WHERE year = 2027`,
              )
              .run(JSON.stringify({ v: 1, expectedDurationDays: 2, turnTimerSeconds: 240 }));
          }
          return originalBatch(statements);
        },
      },
    };

    const publish = await app.fetch(
      new Request('http://x/api/admin/rule-books/2027.2/publish', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'A race cannot freeze stale configuration settings.' }),
      }),
      env,
    );

    expect(publish.status).toBe(409);
    expect(await publish.json()).toEqual({ error: 'rule_book_status_changed' });
    expect(
      (await h.db.run("SELECT status FROM rule_books WHERE version = '2027.1'")).results,
    ).toEqual([{ status: 'active' }]);
    expect(
      (await h.db.run("SELECT status FROM rule_books WHERE version = '2027.2'")).results,
    ).toEqual([{ status: 'draft' }]);
  });

  it('uses the same designated configuration for a live session only after it is frozen', async () => {
    expect((await designateDraft(h)).status).toBe(200);

    const prematureLive = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: false }),
    });
    expect(prematureLive.status).toBe(409);
    expect(await prematureLive.json()).toMatchObject({
      policy_error: 'bid_configuration_frozen_required',
    });

    await seedCommittedTeleStaffBaseline(h);
    const publish = await adminRequest(h, '/api/admin/rule-books/2027.2/publish', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Freeze synthetic annual draft configuration.' }),
    });
    expect(publish.status).toBe(200);
    const live = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, is_mock: false }),
    });
    expect(live.status).toBe(201);
    expect(await live.json()).toMatchObject({
      is_mock: false,
      rule_book_version: '2027.2',
      rule_book_revision: 0,
    });
  });
});

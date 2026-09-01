import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'c'.repeat(64);

async function freshAdmin(): Promise<string> {
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

const POLICY_MEMBER_ID = 61;

async function seedActiveSinglePositionPolicy(h: TestD1, now: number): Promise<void> {
  await h.db.run(
    `INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary,
        employment_status, employment_status_effective_on, created_at, updated_at)
     VALUES (${POLICY_MEMBER_ID}, '60061', 'Frozen', 'Member', 'FF', 'FF', 1, 0,
       'active', '2026-01-01', ${now}, ${now});`,
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    `INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Firefighter');`,
  );
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
  );
  await h.db.run(
    `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES ('2026.1', 'A101', '2026.1',
       '{"rank":["FF"],"credentials":[],"custom":[]}',
       '{"max":0,"items":[]}',
       '["points","rsc_seniority","rank_seniority"]');`,
  );
}

async function seedFrozenPolicySnapshot(
  h: TestD1,
  sessionId: string,
  capturedAt: number,
  options: {
    configurationRevision?: number;
    ruleBookRevision?: number;
    staffingBaseline?: {
      baselineAcceptanceId: string;
      importId: string;
      sourceHash: string;
      acceptedAtMs: number;
    };
  } = {},
): Promise<void> {
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
      (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
     VALUES (?, '2026.1', '2026.1', ?, ?, ?);`,
    [
      sessionId,
      options.ruleBookRevision ?? 0,
      JSON.stringify({
        v: 3,
        ruleBookVersion: '2026.1',
        ruleBookRevision: options.ruleBookRevision ?? 0,
        positionTemplateVersion: '2026.1',
        configurationRevision: options.configurationRevision ?? 0,
        settings: {
          v: 2,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: '2026-01-15',
        },
        credentialEvaluationOn: '2026-01-15',
        capturedAtMs: capturedAt,
        members: [
          {
            memberId: POLICY_MEMBER_ID,
            pool: 'FF',
            rscSeniority: 1,
            rankSeniority: null,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank: 'FF',
            isProbationary: false,
            credentialNames: [],
          },
        ],
        ruleBookMaterial: {
          v: 1,
          rules: [
            {
              ruleBookVersion: '2026.1',
              positionId: 'A101',
              templateVersion: '2026.1',
              requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
              pointsPreferenceJson: '{"max":0,"items":[]}',
              tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
            },
          ],
          positions: [
            {
              id: 'A101',
              templateVersion: '2026.1',
              bidParticipation: 'BIDDABLE',
              isExcludedFromCount: false,
              shift: 'A',
              station: '1',
              unit: 'Engine 1',
              rankRequired: 'FF',
              positionName: 'Firefighter',
            },
          ],
        },
        ...(options.staffingBaseline ? { staffingBaseline: options.staffingBaseline } : {}),
      }),
      capturedAt,
    ],
  );
}

async function seedAcceptedOfficialBaselineForLiveReadiness(h: TestD1): Promise<void> {
  const sourceHash = 'a'.repeat(64);
  await h.db.run(
    `INSERT INTO staffing_positions
       (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
        active_from, review_status, created_at, updated_at)
     VALUES ('live-readiness-slot', 'SYNTHETIC/A/1/FF', 'A', '1', 'Engine 1',
       'Firefighter', 'FF', '2026-01-01', 'approved', 1, 1);
     INSERT INTO staffing_position_source_mappings
       (id, staffing_position_id, source_system, source_locator, source_signature,
        source_version, source_hash, effective_from, created_at)
     VALUES ('live-readiness-mapping', 'live-readiness-slot', 'telestaff',
       '{"v":1,"shift":"A","division":"Suppression","station":"1","unit":"Engine 1","position":"Firefighter"}',
       '${sourceHash}', 'synthetic-v1', '${sourceHash}', '2026-01-01', 1);
     INSERT INTO assignment_imports
       (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
        status, input_row_count, normalized_data_row_count, unique_employee_count,
        report_row_count, structural_row_count, source_snapshot_as_of, created_at)
     VALUES ('live-readiness-import', 'telestaff', 'synthetic-v1', '${sourceHash}',
       'TELSTAFF_ASSIGNMENTS_HTML_V1', 'telestaff-assignments-html@1',
       'official', 'staged', 1, 1, 1, 1, 0, '2026-08-24', 1);
     INSERT INTO assignment_import_rows
       (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
        resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology,
        disposition, reconciliation_classification, review_status, created_at)
     VALUES ('live-readiness-row', 'live-readiness-import', 1, '${'b'.repeat(64)}',
       '${'c'.repeat(64)}', ${POLICY_MEMBER_ID}, 'live-readiness-mapping',
       '{"v":1,"shift":"A","division":"Suppression","station":"1","unit":"Engine 1","position":"Firefighter"}',
       'unchanged', 'UNCHANGED', 'not_required', 1);
     UPDATE assignment_imports SET status = 'reviewed' WHERE id = 'live-readiness-import';
     UPDATE assignment_imports
       SET status = 'approved', approved_at = 1, approved_by_member_id = 1
       WHERE id = 'live-readiness-import';
     UPDATE assignment_imports SET status = 'committed', committed_at = 1
       WHERE id = 'live-readiness-import';
     INSERT INTO assignment_observations
       (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id,
        staffing_position_source_mapping_id, normalized_source_topology, observed_at, created_at)
     VALUES ('live-readiness-observation', 'live-readiness-import', 'live-readiness-row', ${POLICY_MEMBER_ID},
       'live-readiness-slot', 'live-readiness-mapping',
       '{"v":1,"shift":"A","division":"Suppression","station":"1","unit":"Engine 1","position":"Firefighter"}',
       1, 1);
     INSERT INTO member_assignments
       (id, member_id, staffing_position_id, origin_type, origin_ref, source_observation_id,
        status, effective_from, created_at, updated_at)
     VALUES ('live-readiness-assignment', ${POLICY_MEMBER_ID}, 'live-readiness-slot', 'TELESTAFF_IMPORT',
       'live-readiness-import', 'live-readiness-observation', 'active', '2026-01-01', 1, 1);
     INSERT INTO bid_year_staffing_baselines
       (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
        acceptance_reason, created_at)
     VALUES ('live-readiness-baseline', 2026, 'live-readiness-import', 'accepted',
       1, 1, 'Controlled live readiness fixture.', 1);`,
  );
}

describe('POST /api/admin/bid-session', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
    await seedActiveSinglePositionPolicy(h, Date.now());
    await h.db.run(
      `UPDATE bid_years
          SET rule_book_version = '2026.1',
              position_template_version = '2026.1',
              config_json = '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-01-15"}',
              configuration_revision = 1
        WHERE year = 2026;`,
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('creates a session in `config` phase', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bid_year: 2026,
          mode: 'live',
          expected_duration_days: 2,
          turn_timer_seconds: 180,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; current_phase: string };
    expect(body.current_phase).toBe('config');
    expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID shape
  });

  it('rejects an omitted session mode instead of defaulting to a real Bid', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bid_year: 2026 }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
    expect((await h.db.run('SELECT count(*) AS n FROM bid_sessions')).results).toEqual([{ n: 0 }]);
  });

  it('rejects creation when bid_year does not exist', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bid_year: 2099,
          expected_duration_days: 2,
          turn_timer_seconds: 180,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/bid-session/:id/start', () => {
  let h: TestD1;
  let sessionId: string;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'configuring');");
    sessionId = '01HZZ0000000000000000SESS01';
    const now = Date.now();
    await seedActiveSinglePositionPolicy(h, now);
    await h.db.run(
      `UPDATE bid_years
          SET rule_book_version = '2026.1',
              position_template_version = '2026.1',
              config_json = '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-01-15"}',
              configuration_revision = 1
        WHERE year = 2026;`,
    );
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'config', 180, 2, 0);",
      [sessionId, now],
    );
    await seedFrozenPolicySnapshot(h, sessionId, now);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('allows a mock rehearsal to transition config -> position_bid', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [sessionId]);

    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const after = await h.db.run('SELECT current_phase FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    expect(after.results[0]?.current_phase).toBe('position_bid');
    expect(
      (
        await h.db.run('SELECT member_id, pool FROM bid_order WHERE bid_session_id = ?', [
          sessionId,
        ])
      ).results,
    ).toEqual([{ member_id: POLICY_MEMBER_ID, pool: 'FF' }]);
  });

  it('fails closed for a live session when required readiness facts are absent', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'readiness_blocked',
      readiness: {
        canStartLiveBid: false,
        overallStatus: 'BLOCKING',
        blockingCheckIds: expect.arrayContaining([
          'accepted_staffing_baseline',
          'annual_configuration',
          'audit_infrastructure',
          'writeback_safety',
        ]),
      },
    });
    const after = await h.db.run('SELECT current_phase FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    expect(after.results[0]?.current_phase).toBe('config');
  });

  it('exposes an operator-readable fail-closed readiness report to an administrator', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/readiness`, {
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: sessionId,
      is_mock: false,
      readiness: {
        canStartLiveBid: false,
        overallStatus: 'BLOCKING',
        blockingCheckIds: expect.arrayContaining([
          'accepted_staffing_baseline',
          'annual_configuration',
          'audit_infrastructure',
          'writeback_safety',
        ]),
      },
    });
  });

  it('permits a fully evidenced live session to start without enabling writeback', async () => {
    await seedAcceptedOfficialBaselineForLiveReadiness(h);
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?', [
      sessionId,
    ]);
    const revisionRows = await h.db.run('SELECT revision FROM rule_books WHERE version = ?', [
      '2026.1',
    ]);
    const ruleBookRevision = (revisionRows.results[0] as { revision: number }).revision;
    await seedFrozenPolicySnapshot(h, sessionId, Date.now(), {
      configurationRevision: 1,
      ruleBookRevision,
      staffingBaseline: {
        baselineAcceptanceId: 'live-readiness-baseline',
        importId: 'live-readiness-import',
        sourceHash: 'a'.repeat(64),
        acceptedAtMs: 1,
      },
    });
    expect(
      (
        await h.db.run(
          'SELECT rule_book_version, position_template_version, config_json, configuration_revision FROM bid_years WHERE year = 2026',
        )
      ).results,
    ).toMatchObject([
      {
        rule_book_version: '2026.1',
        position_template_version: '2026.1',
        configuration_revision: 1,
      },
    ]);
    const env = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      PORTAL_WRITEBACK_ENABLED: 'false' as const,
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback-disabled.invalid',
      AUDIT_SIGNING_PRIVKEY: 'p'.repeat(32),
      AUDIT_SIGNING_PUBKEY: 'q'.repeat(32),
      KV: { get: async () => null, put: async () => undefined } as never,
      R2_AUDIT: { put: async () => undefined } as never,
      R2_EXPORTS: { put: async () => undefined } as never,
    };

    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      env,
    );

    const responseBody = await res.json();
    expect(responseBody).toMatchObject({ current_phase: 'position_bid' });
    expect(res.status).toBe(200);
    expect(
      (await h.db.run('SELECT is_mock FROM bid_sessions WHERE id = ?', [sessionId])).results,
    ).toEqual([{ is_mock: 0 }]);
  });

  it('performs a passing real-mode dry run without creating a real session', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [sessionId]);
    await seedAcceptedOfficialBaselineForLiveReadiness(h);
    const before = await h.db.run('SELECT count(*) AS n FROM bid_sessions');
    const env = {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
      PORTAL_WRITEBACK_ENABLED: 'false' as const,
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback-disabled.invalid',
      AUDIT_SIGNING_PRIVKEY: 'p'.repeat(32),
      AUDIT_SIGNING_PUBKEY: 'q'.repeat(32),
      KV: { get: async () => null, put: async () => undefined } as never,
      R2_AUDIT: { put: async () => undefined } as never,
      R2_EXPORTS: { put: async () => undefined } as never,
    };

    const res = await app.fetch(
      new Request('http://x/api/admin/bid-session/readiness-preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bid_year: 2026 }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      dry_run: true,
      would_allow_start: true,
      readiness: { canStartLiveBid: true },
    });
    expect(await h.db.run('SELECT count(*) AS n FROM bid_sessions')).toEqual(before);
  });

  it('writes audit log session_start', async () => {
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [sessionId]);

    await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const audit = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'session_start' AND bid_session_id = ?",
      [sessionId],
    );
    expect(audit.results[0]?.n).toBe(1);
  });

  it('fails closed when a config session lacks its frozen policy snapshot', async () => {
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?', [
      sessionId,
    ]);
    await h.db.run('UPDATE bid_sessions SET is_mock = 1 WHERE id = ?', [sessionId]);
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_missing',
    });
  });

  it('returns 409 when session is already past config', async () => {
    await h.db.run("UPDATE bid_sessions SET current_phase = 'position_bid' WHERE id = ?", [
      sessionId,
    ]);
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await freshAdmin()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
  });
});

describe('POST /api/admin/bid-session/:id/pause', () => {
  let h: TestD1;
  let sessionId: string;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    sessionId = '01HZZ0000000000000000SESS02';
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('sets phase to paused and records paused_at', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/pause`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason_code: 'session.pause_emergency',
          reason: 'IT issue in admin room',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run('SELECT current_phase, paused_at FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    const r = rows.results[0] as { current_phase: string; paused_at: number | null } | undefined;
    expect(r?.current_phase).toBe('paused');
    expect(r?.paused_at).toBeGreaterThan(0);
  });

  it('returns 400 when reason missing', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/pause`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason_code: 'session.pause_emergency' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/bid-session/:id/resume', () => {
  let h: TestD1;
  let sessionId: string;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    sessionId = '01HZZ0000000000000000SESS03';
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, paused_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, ?, 'paused', 180, 2, 1);",
      [sessionId, Date.now() - 60000, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('transitions paused -> position_bid and clears paused_at', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/resume`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run('SELECT current_phase, paused_at FROM bid_sessions WHERE id = ?', [
      sessionId,
    ]);
    const r = rows.results[0] as { current_phase: string; paused_at: number | null } | undefined;
    expect(r?.current_phase).toBe('position_bid');
    expect(r?.paused_at).toBeNull();
  });
});

describe('POST /api/admin/bid-session/:id/day-end and day-start', () => {
  let h: TestD1;
  let sessionId: string;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    sessionId = '01HZZ0000000000000000SESS04';
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('day-end stamps scheduled_resume_at and pauses', async () => {
    const resumeTs = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/day-end`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scheduled_resume_at: resumeTs, reason: 'End of day 1.' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run(
      'SELECT current_phase, scheduled_resume_at FROM bid_sessions WHERE id = ?',
      [sessionId],
    );
    const r = rows.results[0] as { current_phase: string; scheduled_resume_at: number } | undefined;
    expect(r?.current_phase).toBe('paused');
    expect(r?.scheduled_resume_at).toBe(new Date(resumeTs).getTime());
  });

  it('day-start resumes and increments day_count and clears scheduled_resume_at', async () => {
    await h.db.run(
      "UPDATE bid_sessions SET current_phase = 'paused', paused_at = ?, scheduled_resume_at = ? WHERE id = ?",
      [Date.now(), Date.now() + 3600000, sessionId],
    );
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/day-start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const rows = await h.db.run(
      'SELECT current_phase, day_count, scheduled_resume_at FROM bid_sessions WHERE id = ?',
      [sessionId],
    );
    const r = rows.results[0] as
      | { current_phase: string; day_count: number; scheduled_resume_at: number | null }
      | undefined;
    expect(r?.current_phase).toBe('position_bid');
    expect(r?.day_count).toBe(2);
    expect(r?.scheduled_resume_at).toBeNull();
  });
});

describe('canonical command authority', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS05';

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, 1);",
      [sessionId, Date.now()],
    );
    await h.db.run(
      `INSERT INTO canonical_bid_session_state (
        bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at
      ) VALUES (?, 1, ?, 'freeze-command', ?, ?)`,
      [
        sessionId,
        JSON.stringify({
          bidSessionId: sessionId,
          currentPhase: 'paused',
          currentBidderId: null,
          turnStartedAtMs: 1,
          turnTimerSeconds: 180,
          lastSeq: 1,
          fills: {},
          bidOrder: [],
          queueCursor: 0,
          frozenAt: 1,
          aDay: null,
        }),
        Date.now(),
        Date.now(),
      ],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns a typed conflict instead of attempting a legacy timer mutation', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/config`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${await freshAdmin()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ turn_timer_seconds: 240 }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'canonical_mutation_requires_command' });
    expect(
      (await h.db.run('SELECT turn_timer_seconds FROM bid_sessions WHERE id = ?', [sessionId]))
        .results,
    ).toEqual([{ turn_timer_seconds: 180 }]);
  });
});

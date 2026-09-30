import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'j'.repeat(64);
async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: '80080',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'B',
      last_name: 'A',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function seedRulebookAndMember(h: TestD1) {
  const now = Date.now();
  await h.db.run(
    "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (80, '80080', 'Eligi', 'Test', 'LT', 'OFC', 50, 0, ?, ?);",
    [now, now],
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES ('A205', '2026.1', 'A', '2', 'Rescue', 'Rescue 2', 'LT', 'Rescue 2 LT');",
  );
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'active');",
  );
  await h.db.run(
    `INSERT INTO position_rules
     (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES ('2026.1', 'A205', '2026.1',
       '{"rank":["LT"],"credentials":[],"custom":["paramedic"]}',
       '{"max":0,"items":[]}',
       '["points","rsc_seniority","rank_seniority"]');`,
  );
}

async function seedFrozenList(h: TestD1, identities = true) {
  const capturedAtMs = Date.UTC(2026, 8, 24);
  const snapshot = {
    v: 3,
    ruleBookVersion: '2026.1',
    ruleBookRevision: 0,
    positionTemplateVersion: '2026.1',
    configurationRevision: 1,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-09-24',
    },
    credentialEvaluationOn: '2026-09-24',
    capturedAtMs,
    members: [
      {
        memberId: 80,
        pool: 'OFC',
        rscSeniority: 50,
        rankSeniority: 1,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'LT',
        isProbationary: false,
        credentialNames: ['Paramedic'],
        scoringEvidence: { evaluationOn: '2026-09-24', completedCredentialNames: ['Paramedic'] },
      },
    ],
    ...(identities
      ? {
          operatorIdentityProjection: [
            {
              memberId: 80,
              employeeId: '80080',
              firstName: 'Eligi',
              lastName: 'Frozen',
              rank: 'CPT',
            },
          ],
        }
      : {}),
    ruleBookMaterial: {
      v: 1,
      positions: [
        {
          id: 'A205',
          templateVersion: '2026.1',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '2',
          unit: 'Rescue 2',
          rankRequired: 'LT',
          positionName: 'Rescue 2 LT',
        },
      ],
      rules: [
        {
          ruleBookVersion: '2026.1',
          positionId: 'A205',
          templateVersion: '2026.1',
          requiredCriteriaJson: '{"rank":["LT"],"credentials":[],"custom":["paramedic"]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["rsc_seniority"]',
        },
      ],
    },
  };
  await h.db.run(
    "INSERT INTO bid_sessions(id,bid_year,started_at,current_phase,turn_timer_seconds,expected_duration_days,day_count,is_mock) VALUES ('frozen-list',2026,1,'position_bid',180,2,0,1)",
  );
  await h.db.run(
    'INSERT INTO bid_session_policy_snapshots(bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at) VALUES (?, ?, ?, 0, ?, ?)',
    ['frozen-list', '2026.1', '2026.1', JSON.stringify(snapshot), capturedAtMs],
  );
}

describe('POST /api/admin/eligibility/preview', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await seedRulebookAndMember(h);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('returns eligible=false with PARAMEDIC_REQUIRED for member missing Paramedic cert', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 80,
          position_id: 'A205',
          rule_book_version: '2026.1',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { eligible: boolean; reasons: { code: string }[] };
    expect(body.eligible).toBe(false);
    expect(body.reasons.some((r) => r.code === 'PARAMEDIC_REQUIRED')).toBe(true);
  });

  it('returns eligible=true after granting Paramedic cert', async () => {
    await h.db.run("INSERT INTO credentials (id, name) VALUES (1, 'Paramedic');");
    await h.db.run('INSERT INTO member_credentials (member_id, credential_id) VALUES (80, 1);');
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 80,
          position_id: 'A205',
          rule_book_version: '2026.1',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = (await res.json()) as { eligible: boolean };
    expect(body.eligible).toBe(true);
  });

  it('builds the official position list and downloads single-position Excel and PDF', async () => {
    await h.db.run(
      "UPDATE members SET employment_status='active', employment_status_effective_on='2026-01-01', rank_seniority=1 WHERE id=80;",
    );
    await h.db.run("INSERT INTO credentials (id, name) VALUES (1, 'Paramedic');");
    await h.db.run('INSERT INTO member_credentials (member_id, credential_id) VALUES (80, 1);');
    const authorization = `Bearer ${await adminJwt()}`;
    const base =
      'http://x/api/admin/eligibility?position_id=A205&rule_book_version=2026.1&as_of=2026-09-24&bid_year=2026';
    const list = await app.fetch(
      new Request(base.replace('/eligibility?', '/eligibility/list?'), {
        headers: { Authorization: authorization },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      positionId: 'A205',
      asOf: '2026-09-24',
      eligible: [{ priority: 1, member: { employeeId: '80080' } }],
      excluded: [],
      dataBlocked: [],
    });

    for (const format of ['xlsx', 'pdf'] as const) {
      const response = await app.fetch(
        new Request(
          `${base.replace('/eligibility?', '/eligibility/export?')}&format=${format}&scope=single`,
          { headers: { Authorization: authorization } },
        ),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(500);
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe(
        format === 'pdf' ? '%PDF' : 'PK\u0003\u0004',
      );
    }
    const massExport = await app.fetch(
      new Request(
        `${base.replace('/eligibility?', '/eligibility/export?')}&format=xlsx&scope=all`,
        { headers: { Authorization: authorization } },
      ),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(massExport.status).toBe(200);
    expect(massExport.headers.get('content-disposition')).toContain('all-positions');
  });

  it('retains annual participants with unknown global employment status and frozen rank, identity, qualifications and ordering', async () => {
    await seedFrozenList(h);
    await h.db.run(
      "UPDATE members SET rank='DC', first_name='Changed', last_name='Directory', employment_status='unknown' WHERE id=80",
    );
    const headers = { Authorization: `Bearer ${await adminJwt()}` };
    const query =
      'position_id=A205&rule_book_version=2026.1&as_of=2026-09-24&bid_year=2026&session_id=frozen-list';
    const list = await app.fetch(
      new Request(`http://x/api/admin/eligibility/list?${query}`, { headers }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      eligible: [
        {
          priority: 1,
          member: {
            memberId: 80,
            employeeId: '80080',
            firstName: 'Eligi',
            lastName: 'Frozen',
            rank: 'LT',
          },
        },
      ],
      excluded: [],
      dataBlocked: [],
      sessionId: 'frozen-list',
    });
    for (const format of ['xlsx', 'pdf']) {
      const exportResult = await app.fetch(
        new Request(`http://x/api/admin/eligibility/export?${query}&scope=all&format=${format}`, {
          headers,
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );
      expect(exportResult.status).toBe(200);
      expect((await exportResult.arrayBuffer()).byteLength).toBeGreaterThan(500);
    }
    const context = await app.fetch(
      new Request('http://x/api/admin/eligibility/context?session_id=frozen-list', { headers }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    await expect(context.json()).resolves.toMatchObject({
      asOf: '2026-09-24',
      members: [{ id: 80, rank: 'LT', lastName: 'Frozen' }],
    });
  });

  it('rejects mismatched dates, rule books and missing session evidence without falling back to the global roster', async () => {
    await seedFrozenList(h);
    const headers = { Authorization: `Bearer ${await adminJwt()}` };
    for (const suffix of [
      'as_of=2026-09-30&session_id=frozen-list',
      'rule_book_version=2026.2&session_id=frozen-list',
      'session_id=missing',
    ]) {
      const params = new URLSearchParams('position_id=A205&rule_book_version=2026.1&bid_year=2026');
      for (const [key, value] of new URLSearchParams(suffix)) params.set(key, value);
      const response = await app.fetch(
        new Request(`http://x/api/admin/eligibility/list?${params}`, { headers }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );
      expect(response.status).toBe(409);
    }
  });

  it('requires frozen identity evidence instead of inventing names or employee IDs', async () => {
    await seedFrozenList(h, false);
    const response = await app.fetch(
      new Request('http://x/api/admin/eligibility/context?session_id=frozen-list', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'session_identity_evidence_missing',
    });
  });

  it('uses effective-dated qualification evidence instead of a timeless legacy credential row', async () => {
    await h.db.run("INSERT INTO credentials (id, name) VALUES (1, 'Paramedic');");
    await h.db.run(
      "INSERT INTO member_credentials (member_id, credential_id, start_date, expiration_date) VALUES (80, 1, '2026-10-01', '2026-12-31');",
    );
    const requestAt = async (asOf: string) =>
      app.fetch(
        new Request('http://x/api/admin/eligibility/preview', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await adminJwt()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            member_id: 80,
            position_id: 'A205',
            rule_book_version: '2026.1',
            as_of: asOf,
          }),
        }),
        { ...h.env, JWT_SIGNING_KEY: KEY },
      );

    const beforeStart = await requestAt('2026-09-30');
    expect(beforeStart.status).toBe(200);
    await expect(beforeStart.json()).resolves.toMatchObject({ eligible: false });

    const whileActive = await requestAt('2026-10-02');
    expect(whileActive.status).toBe(200);
    await expect(whileActive.json()).resolves.toMatchObject({ eligible: true });

    await h.db.run(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, kind, effective_on, expires_on,
          evidence_source, evidence_reference, reason, actor_subject, idempotency_key,
          before_state, after_state, created_at)
       VALUES ('preview-paramedic-revocation', 80, 1, NULL, 'CERTIFICATION_REVOKED', '2026-11-01', NULL,
        'synthetic-state-registry', 'SYNTH-PREVIEW-REVOKE', 'Synthetic revocation evidence.', '0',
        'preview-paramedic-revocation', '{}', '{}', 1);`,
    );
    const afterRevocation = await requestAt('2026-11-02');
    expect(afterRevocation.status).toBe(200);
    await expect(afterRevocation.json()).resolves.toMatchObject({ eligible: false });
  });

  it('uses the specified rule_book_version when provided', async () => {
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.2', 2026, 'draft');",
    );
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.2', 'A205', '2026.1',
         '{"rank":["LT"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 80, position_id: 'A205', rule_book_version: '2026.2' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    const body = (await res.json()) as { eligible: boolean };
    expect(body.eligible).toBe(true);
  });

  it('requires an explicit version even when exactly one annual book is active', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 80, position_id: 'A205' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'rule_book_version_required',
      rule_book_version_required: true,
      configuration_required: true,
    });
  });

  it('blocks a preview when another rule in the selected book is invalid', async () => {
    await h.db.run(
      `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
       VALUES ('2026.1', 'B101', '2026.1',
         '{"rank":["FF"],"credentials":[],"custom":["pre_bid_pool"]}',
         '{"max":0,"items":[]}',
         '["points","rsc_seniority","rank_seniority"]');`,
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 80,
          position_id: 'A205',
          rule_book_version: '2026.1',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'rule_book_invalid',
      invalid_position_ids: ['B101'],
    });
  });

  it('does not award Technician points when the all-six Operations gate is incomplete', async () => {
    const operations = [
      'Hazardous Materials Operations',
      'Rope Rescue Operations',
      'Confined Space Operations',
      'Structural Collapse Operations',
      'Trench Rescue Operations',
      'Vehicle & Machinery Rescue Operations',
    ];
    const held = [
      'Rope Rescue Technician',
      ...operations.filter((name) => name !== 'Trench Rescue Operations'),
    ];
    for (const [index, name] of held.entries()) {
      await h.db.run('INSERT INTO credentials (id, name) VALUES (?, ?);', [index + 1, name]);
      await h.db.run('INSERT INTO member_credentials (member_id, credential_id) VALUES (80, ?);', [
        index + 1,
      ]);
    }
    await h.db.run(
      `UPDATE position_rules
       SET points_preference = '{"max":2,"items":[{"points":2,"credential":"Rope Rescue Technician","gating":"ops_all_6"}]}'
       WHERE position_id = 'A205' AND rule_book_version = '2026.1';`,
    );

    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          member_id: 80,
          position_id: 'A205',
          rule_book_version: '2026.1',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { points: number };
    expect(body.points).toBe(0);
  });

  it('requires an explicit version before inspecting active rule-book state', async () => {
    await h.db.run("UPDATE rule_books SET status = 'archived' WHERE version = '2026.1';");
    const res = await app.fetch(
      new Request('http://x/api/admin/eligibility/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member_id: 80, position_id: 'A205' }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'rule_book_version_required',
      rule_book_version_required: true,
      configuration_required: true,
    });
  });
});

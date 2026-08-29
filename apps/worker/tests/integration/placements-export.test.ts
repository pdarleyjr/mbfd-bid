import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'k'.repeat(64);
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

async function seedTwoBids(h: TestD1, sessionId: string) {
  const now = Date.now();
  await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
    [sessionId, now],
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    `INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name)
     VALUES
       ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Engine 1 FF'),
       ('B202', '2026.1', 'B', '2', 'Rescue', 'Rescue 2', 'LT', 'Rescue 2 LT');`,
  );
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.1', 2026, 'draft');",
  );
  await h.db.run(
    `INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria,
        points_preference, tie_break_chain)
     VALUES
       ('2026.1', 'A101', '2026.1',
        '{"rank":["FF"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]'),
       ('2026.1', 'B202', '2026.1',
        '{"rank":["LT"],"credentials":[],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]');`,
  );
  await h.db.run(
    `INSERT INTO rule_book_position_participation
       (rule_book_version, position_id, template_version, bid_participation,
        authoritative_source_ref, created_at)
     VALUES
       ('2026.1', 'A101', '2026.1', 'BIDDABLE', 'synthetic/placements/A101', ${now}),
       ('2026.1', 'B202', '2026.1', 'BIDDABLE', 'synthetic/placements/B202', ${now});`,
  );
  await h.db.run("UPDATE rule_books SET status = 'active' WHERE version = '2026.1';");
  await h.db.run(
    `INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at)
     VALUES
       (100, 'EMP100', 'Anna', 'Adams', 'FF', 'FF', 10, 0, ?, ?),
       (101, 'EMP101', 'Bea', 'Brown, Jr.', 'LT', 'OFC', 11, 0, ?, ?);`,
    [now, now, now, now],
  );
  await h.db.run(
    `INSERT INTO bids
     (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
     VALUES
       ('01HZZBID000000000000ORD1', ?, 1, 100, 'A101', ?, 0, 'k1', 'pending', 0),
       ('01HZZBID000000000000ORD2', ?, 2, 101, 'B202', ?, 1, 'k2', 'pending', 0);`,
    [sessionId, now, sessionId, now],
  );
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision,
        snapshot_json, captured_at)
     VALUES (?, '2026.1', '2026.1', 0, ?, ?);`,
    [
      sessionId,
      JSON.stringify({
        v: 3,
        ruleBookVersion: '2026.1',
        ruleBookRevision: 0,
        positionTemplateVersion: '2026.1',
        configurationRevision: 0,
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
        capturedAtMs: now,
        members: [
          {
            memberId: 100,
            pool: 'FF',
            rscSeniority: 10,
            rankSeniority: null,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank: 'FF',
            isProbationary: false,
            credentialNames: [],
          },
          {
            memberId: 101,
            pool: 'OFC',
            rscSeniority: 11,
            rankSeniority: null,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank: 'LT',
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
            {
              ruleBookVersion: '2026.1',
              positionId: 'B202',
              templateVersion: '2026.1',
              requiredCriteriaJson: '{"rank":["LT"],"credentials":[],"custom":[]}',
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
              positionName: 'Engine 1 FF',
            },
            {
              id: 'B202',
              templateVersion: '2026.1',
              bidParticipation: 'BIDDABLE',
              isExcludedFromCount: false,
              shift: 'B',
              station: '2',
              unit: 'Rescue 2',
              rankRequired: 'LT',
              positionName: 'Rescue 2 LT',
            },
          ],
        },
      }),
      now,
    ],
  );
}

describe('GET /api/admin/placements/export', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000SESS50';
  beforeEach(async () => {
    h = await setupTestD1();
    await seedTwoBids(h, sessionId);
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('emits snapshot-only placement rows in ordinal asc order', async () => {
    // The source roster and template can advance after this established
    // session. The export must remain replayable from its V3 snapshot, and
    // must not expose source employee IDs or names.
    await h.db.run(
      "UPDATE members SET employee_id = 'MUTATED-100', first_name = 'Changed', last_name = 'Roster' WHERE id = 100;",
    );
    await h.db.run(
      "UPDATE positions SET station = '99', unit = 'Mutable Unit', position_name = 'Mutable Position' WHERE id = 'A101';",
    );
    const res = await app.fetch(
      new Request(`http://x/api/admin/placements/export?bid_session_id=${sessionId}&format=csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
    const lines = (await res.text()).split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'ordinal,member_id,member_label,member_rank,position_id,position_name,shift,station,unit,rank_required,a_day,forced,admin_actor_id,picked_at',
    );
    expect(lines[1]).toMatch(
      /^1,100,snapshot-member-100,FF,A101,Engine 1 FF,A,1,Engine 1,FF,,false,,/,
    );
    expect(lines[2]).toMatch(
      /^2,101,snapshot-member-101,LT,B202,Rescue 2 LT,B,2,Rescue 2,LT,,true,,/,
    );
    const body = lines.join('\n');
    expect(body).not.toContain('EMP100');
    expect(body).not.toContain('Anna');
    expect(body).not.toContain('Adams');
    expect(body).not.toContain('MUTATED-100');
    expect(body).not.toContain('Mutable Position');
  });

  it('accepts session_id as an alias for bid_session_id', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/placements/export?session_id=${sessionId}&format=csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('ordinal,member_id');
    expect(body).toContain('snapshot-member-100');
  });

  it('fails closed when a legacy snapshot lacks immutable export material', async () => {
    const now = Date.now();
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?', [
      sessionId,
    ]);
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, rule_book_revision,
          snapshot_json, captured_at)
       VALUES (?, '2026.1', '2026.1', 0, ?, ?);`,
      [
        sessionId,
        JSON.stringify({
          v: 2,
          ruleBookVersion: '2026.1',
          ruleBookRevision: 0,
          positionTemplateVersion: '2026.1',
          configurationRevision: 0,
          settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
          capturedAtMs: now,
          members: [],
        }),
        now,
      ],
    );
    const res = await app.fetch(
      new Request(`http://x/api/admin/placements/export?bid_session_id=${sessionId}&format=csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_material_missing',
    });
  });

  it('fails closed when a persisted pick cannot resolve within the snapshot', async () => {
    await h.db.run(
      `INSERT INTO bids
       (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
        idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('01HZZBID000000000000ORD3', ?, 3, 999, 'X999', ?, 0, 'k3', 'pending', 0);`,
      [sessionId, Date.now()],
    );
    const res = await app.fetch(
      new Request(`http://x/api/admin/placements/export?bid_session_id=${sessionId}&format=csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_reference_missing',
    });
  });

  it('fails closed for excluded members and non-biddable positions retained in a snapshot', async () => {
    const stored = (
      await h.db.run(
        'SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id = ?',
        [sessionId],
      )
    ).results[0] as { snapshot_json: string } | undefined;
    if (stored === undefined) throw new Error('expected placement snapshot fixture');
    const snapshot = JSON.parse(stored.snapshot_json) as {
      capturedAtMs: number;
      members: Array<Record<string, unknown>>;
      ruleBookMaterial: { positions: Array<Record<string, unknown>> };
    };
    snapshot.members.push({
      memberId: 102,
      pool: 'EXCLUDED',
      rscSeniority: 12,
      rankSeniority: null,
      exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
      authoritativeAssignmentId: null,
      rank: 'FF',
      isProbationary: false,
      credentialNames: [],
    });
    snapshot.ruleBookMaterial.positions.push({
      id: 'C303',
      templateVersion: '2026.1',
      bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
      isExcludedFromCount: false,
      shift: 'C',
      station: '3',
      unit: 'Command 3',
      rankRequired: 'DC',
      positionName: 'Command 3 DC',
    });
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?', [
      sessionId,
    ]);
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, rule_book_revision,
          snapshot_json, captured_at)
       VALUES (?, '2026.1', '2026.1', 0, ?, ?);`,
      [sessionId, JSON.stringify(snapshot), snapshot.capturedAtMs],
    );
    await h.db.run(
      `INSERT INTO bids
       (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
        idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('01HZZBID000000000000ORD4', ?, 3, 102, 'A101', ?, 0, 'k4', 'pending', 0);`,
      [sessionId, Date.now()],
    );

    const excludedMember = await app.fetch(
      new Request(`http://x/api/admin/placements/export?bid_session_id=${sessionId}&format=csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(excludedMember.status).toBe(409);
    expect(await excludedMember.json()).toEqual({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_reference_invalid',
    });

    await h.db.run("DELETE FROM bids WHERE id = '01HZZBID000000000000ORD4';");
    await h.db.run(
      `INSERT INTO bids
       (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
        idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('01HZZBID000000000000ORD5', ?, 3, 100, 'C303', ?, 0, 'k5', 'pending', 0);`,
      [sessionId, Date.now()],
    );
    const nonBiddablePosition = await app.fetch(
      new Request(`http://x/api/admin/placements/export?bid_session_id=${sessionId}&format=csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(nonBiddablePosition.status).toBe(409);
    expect(await nonBiddablePosition.json()).toEqual({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_reference_invalid',
    });
  });

  it('returns 400 when bid_session_id is missing', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/placements/export?format=csv', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when bid_session_id does not exist', async () => {
    const res = await app.fetch(
      new Request(
        'http://x/api/admin/placements/export?bid_session_id=01HZZNONE0000000000000X&format=csv',
        {
          headers: { Authorization: `Bearer ${await adminJwt()}` },
        },
      ),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/exports/:sessionId/progress.csv', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000PROG50';

  beforeEach(async () => {
    h = await setupTestD1();
    await seedTwoBids(h, sessionId);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('exports self-describing current progress from the immutable session policy', async () => {
    const res = await app.fetch(
      new Request(`http://x/api/admin/exports/${sessionId}/progress.csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
    const csv = await res.text();
    expect(csv).toContain(
      'export_kind,bid_session_id,bid_year,is_mock,bid_state,configuration_revision,rule_book_version,rule_book_revision,position_template_version,roster_snapshot_at,last_committed_command_id,last_committed_command_sequence,awards_committed,exported_at',
    );
    expect(csv).toContain(`bid_progress,${sessionId},2026,false,position_bid,0,2026.1,0,2026.1,`);
    expect(csv).toContain(',0,2,');
    expect(csv).not.toContain('EMP100');
    expect(csv).not.toContain('Anna');
  });

  it('fails closed when immutable V3 material is unavailable', async () => {
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?', [
      sessionId,
    ]);

    const res = await app.fetch(
      new Request(`http://x/api/admin/exports/${sessionId}/progress.csv`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_policy_snapshot_missing',
    });
  });
});

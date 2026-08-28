// W35 — /api/admin/exports/roster-data endpoint.
//
// Browserless renders the web RSC roster page to PDF. That page calls this
// worker endpoint with the HMAC print-token. The endpoint MUST:
//   1. Reject missing query params with 400.
//   2. Reject invalid / expired print tokens with 401 (no admin JWT path).
//   3. Reconstruct the print payload from the immutable V3 session policy
//      material, never from mutable roster or position rows.
//   4. Return only a per-session pseudonym and frozen rank for a resolved
//      member; no names or employee identifiers belong in the print payload.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintPrintToken } from '../../src/exports/print-token.js';
import { app } from '../../src/index.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const PRINT_SECRET = 'p'.repeat(64);

describe('GET /api/admin/exports/roster-data (W35)', () => {
  let h: TestD1;
  const sessionId = '01HZZ0000000000000000ROSTER';

  beforeEach(async () => {
    h = await setupTestD1();

    // Position template + 5 A-shift positions across two stations.
    await h.db.run(
      "INSERT INTO position_templates (version, effective_year) VALUES ('2026.v1', 2026);",
    );
    const positionsToInsert = [
      ['A101', 'A', '21', 'Engine 21', 'FF'],
      ['A102', 'A', '21', 'Engine 21', 'FF'],
      ['A201', 'A', '22', 'Rescue 22', 'LT'],
      ['A202', 'A', '22', 'Rescue 22', 'FF'],
      ['A203', 'A', '22', 'Rescue 22', 'FF'],
    ] as const;
    for (const [id, shift, station, unit, rank] of positionsToInsert) {
      await h.db.run(
        "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name, is_floating, is_vacant_by_design, is_excluded_from_count) VALUES (?, '2026.v1', ?, ?, 'Combat', ?, ?, ?, 0, 0, 0);",
        [id, shift, station, unit, rank, `Pos ${id}`],
      );
    }

    // 5 members + 5 bids.
    await h.db.run("INSERT INTO bid_years (year, status) VALUES (2026, 'live');");
    await h.db.run(
      "INSERT INTO rule_books (version, effective_year, status, revision) VALUES ('2026.roster', 2026, 'draft', 0);",
    );
    const capturedAtMs = Date.now();
    await h.db.run(
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, capturedAtMs],
    );
    for (let i = 1; i <= 5; i++) {
      await h.db.run(
        "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (?, ?, ?, 'Test', ?, 'FF', ?, 0, ?, ?);",
        [i, `1000${i}`, `Member${i}`, i === 3 ? 'LT' : 'FF', 100 + i, Date.now(), Date.now()],
      );
    }
    const positionIds = ['A101', 'A102', 'A201', 'A202', 'A203'];
    for (let i = 0; i < 5; i++) {
      await h.db.run(
        "INSERT INTO bids (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending', 0);",
        [`bid-${i + 1}`, sessionId, i + 1, i + 1, positionIds[i], Date.now(), `idem-${i + 1}`],
      );
    }

    // This material is the sole source of the established session roster. It
    // deliberately carries no names or employee identifiers.
    const snapshot = {
      v: 3,
      ruleBookVersion: '2026.roster',
      ruleBookRevision: 0,
      positionTemplateVersion: '2026.v1',
      configurationRevision: 0,
      settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
      capturedAtMs,
      members: [
        ...Array.from({ length: 5 }, (_, index) => {
          const memberId = index + 1;
          return {
            memberId,
            pool: 'FF',
            rscSeniority: 100 + memberId,
            rankSeniority: null,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank: memberId === 3 ? 'LT' : 'FF',
            isProbationary: false,
            credentialNames: [],
          };
        }),
        {
          memberId: 6,
          pool: 'EXCLUDED',
          rscSeniority: 106,
          rankSeniority: null,
          exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
          authoritativeAssignmentId: null,
          rank: 'FF',
          isProbationary: false,
          credentialNames: [],
        },
      ],
      ruleBookMaterial: {
        v: 1,
        rules: positionsToInsert.map(([id, , , , rank]) => ({
          ruleBookVersion: '2026.roster',
          positionId: id,
          templateVersion: '2026.v1',
          requiredCriteriaJson: JSON.stringify({ rank: [rank], credentials: [], custom: [] }),
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
        })),
        positions: [
          ...positionsToInsert.map(([id, shift, station, unit, rank]) => ({
            id,
            templateVersion: '2026.v1',
            bidParticipation: 'BIDDABLE',
            isExcludedFromCount: false,
            shift,
            station,
            unit,
            rankRequired: rank,
            positionName: `Pos ${id}`,
          })),
          {
            id: 'B999',
            templateVersion: '2026.v1',
            bidParticipation: 'ADMIN_ASSIGNED_NON_BIDDABLE',
            isExcludedFromCount: false,
            shift: 'B',
            station: '99',
            unit: 'Admin 99',
            rankRequired: 'FF',
            positionName: 'Administrative Assignment',
          },
        ],
      },
    };
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
       VALUES (?, '2026.roster', '2026.v1', 0, ?, ?);`,
      [sessionId, JSON.stringify(snapshot), capturedAtMs],
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('400 when session_id/shift/token query params are missing', async () => {
    const res = await app.fetch(
      new Request('http://x/api/admin/exports/roster-data?session_id=x'),
      { ...h.env, PRINT_TOKEN_SECRET: PRINT_SECRET },
    );
    expect(res.status).toBe(400);
  });

  it('400 when shift is not A/B/C/D', async () => {
    const token = mintPrintToken(
      { kind: 'roster', shift: 'A', session_id: sessionId },
      PRINT_SECRET,
    );
    const res = await app.fetch(
      new Request(
        `http://x/api/admin/exports/roster-data?session_id=${sessionId}&shift=Z&token=${token}`,
      ),
      { ...h.env, PRINT_TOKEN_SECRET: PRINT_SECRET },
    );
    expect(res.status).toBe(400);
  });

  it('401 when the print token is invalid', async () => {
    const res = await app.fetch(
      new Request(
        `http://x/api/admin/exports/roster-data?session_id=${sessionId}&shift=A&token=bogus.token`,
      ),
      { ...h.env, PRINT_TOKEN_SECRET: PRINT_SECRET },
    );
    expect(res.status).toBe(401);
  });

  it('reconstructs the roster from V3 snapshot material and exposes only pseudonymous members', async () => {
    // If this endpoint reached the mutable source tables, these changes would
    // leak into the established session export.
    await h.db.run(
      "UPDATE positions SET station = 'MUTATED', unit = 'Changed Unit', rank_required = 'CPT' WHERE id = 'A101';",
    );
    await h.db.run(
      "UPDATE members SET employee_id = 'LEAK-10001', first_name = 'Changed', last_name = 'Person', rank = 'CPT', rsc_seniority = 999 WHERE id = 1;",
    );
    const token = mintPrintToken(
      { kind: 'roster', shift: 'A', session_id: sessionId },
      PRINT_SECRET,
    );
    const res = await app.fetch(
      new Request(
        `http://x/api/admin/exports/roster-data?session_id=${sessionId}&shift=A&token=${encodeURIComponent(
          token,
        )}`,
      ),
      { ...h.env, PRINT_TOKEN_SECRET: PRINT_SECRET },
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      year: number;
      shift: 'A';
      station_count: number;
      position_count: number;
      stations: Array<{
        station: string;
        rows: Array<{
          position_id: string;
          unit: string;
          rank: string;
          member_id: string | null;
          member_name: string | null;
          member_rank: string | null;
          rsc_seniority: number | null;
        }>;
      }>;
      members: Array<{
        memberId: string;
        rank: string;
        positionId: string;
        station: string;
        unit: string;
      }>;
      generatedAt: string;
    };

    expect(body.shift).toBe('A');
    expect(body.position_count).toBe(5);
    expect(body.station_count).toBe(2);
    expect(body.stations).toHaveLength(2);

    // Stations are sorted lexicographically: "21" before "22".
    expect(body.stations[0]?.station).toBe('21');
    expect(body.stations[0]?.rows).toHaveLength(2);
    expect(body.stations[1]?.station).toBe('22');
    expect(body.stations[1]?.rows).toHaveLength(3);

    // W35 flat members array — one entry per bid.
    expect(body.members).toHaveLength(5);
    const m = body.members.find((x) => x.positionId === 'A101');
    expect(m).toBeDefined();
    expect(m?.memberId).toBe('M-001');
    expect(m?.rank).toBe('FF');
    expect(m?.station).toBe('21');
    expect(m?.unit).toBe('Engine 21');

    const firstRow = body.stations[0]?.rows.find((row) => row.position_id === 'A101');
    expect(firstRow).toMatchObject({
      position_id: 'A101',
      unit: 'Engine 21',
      rank: 'FF',
      member_id: 'M-001',
      member_name: 'Member M-001',
      member_rank: 'FF',
      rsc_seniority: 101,
    });
    expect(JSON.stringify(body)).not.toContain('LEAK-10001');
    expect(JSON.stringify(body)).not.toContain('Changed Person');
    expect(JSON.stringify(body)).not.toContain('10001');

    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('fails closed when the session snapshot has no immutable V3 material', async () => {
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?;', [
      sessionId,
    ]);
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
       VALUES (?, '2026.roster', '2026.v1', NULL, ?, ?);`,
      [
        sessionId,
        JSON.stringify({
          v: 1,
          ruleBookVersion: '2026.roster',
          positionTemplateVersion: '2026.v1',
          capturedAtMs: Date.now(),
          members: [],
        }),
        Date.now(),
      ],
    );
    const token = mintPrintToken(
      { kind: 'roster', shift: 'A', session_id: sessionId },
      PRINT_SECRET,
    );
    const res = await app.fetch(
      new Request(
        `http://x/api/admin/exports/roster-data?session_id=${sessionId}&shift=A&token=${encodeURIComponent(token)}`,
      ),
      { ...h.env, PRINT_TOKEN_SECRET: PRINT_SECRET },
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'session_policy_snapshot_material_missing',
    });
  });

  it('fails closed when direct bid history references an excluded member or non-biddable snapshot position', async () => {
    await h.db.run(
      `INSERT INTO bids
         (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('corrupt-excluded-member', ?, 6, 6, 'A101', ?, 0, 'corrupt-excluded-member', 'pending', 0);`,
      [sessionId, Date.now()],
    );
    const token = mintPrintToken(
      { kind: 'roster', shift: 'A', session_id: sessionId },
      PRINT_SECRET,
    );
    const excludedMemberResponse = await app.fetch(
      new Request(
        `http://x/api/admin/exports/roster-data?session_id=${sessionId}&shift=A&token=${encodeURIComponent(token)}`,
      ),
      { ...h.env, PRINT_TOKEN_SECRET: PRINT_SECRET },
    );
    expect(excludedMemberResponse.status).toBe(409);
    await expect(excludedMemberResponse.json()).resolves.toEqual({
      error: 'session_bid_reference_invalid',
    });

    await h.db.run("DELETE FROM bids WHERE id = 'corrupt-excluded-member';");
    await h.db.run(
      `INSERT INTO bids
         (id, bid_session_id, ordinal, member_id, position_id, picked_at, forced, idempotency_key, portal_sync_status, portal_sync_attempts)
       VALUES ('corrupt-non-biddable', ?, 6, 1, 'B999', ?, 0, 'corrupt-non-biddable', 'pending', 0);`,
      [sessionId, Date.now()],
    );
    const nonBiddableResponse = await app.fetch(
      new Request(
        `http://x/api/admin/exports/roster-data?session_id=${sessionId}&shift=A&token=${encodeURIComponent(token)}`,
      ),
      { ...h.env, PRINT_TOKEN_SECRET: PRINT_SECRET },
    );
    expect(nonBiddableResponse.status).toBe(409);
    await expect(nonBiddableResponse.json()).resolves.toEqual({
      error: 'session_bid_reference_invalid',
    });
  });
});

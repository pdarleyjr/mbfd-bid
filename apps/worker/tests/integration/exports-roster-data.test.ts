// W35 — /api/admin/exports/roster-data endpoint.
//
// Browserless renders the web RSC roster page to PDF. That page calls this
// worker endpoint with the HMAC print-token. The endpoint MUST:
//   1. Reject missing query params with 400.
//   2. Reject invalid / expired print tokens with 401 (no admin JWT path).
//   3. Return the RosterPayload shape the web page expects, AND the W35
//      flat `members: []` array for direct consumers.

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
      "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1);",
      [sessionId, Date.now()],
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

  it('returns the RosterPayload shape with stations + flat members array', async () => {
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
          member_name: string | null;
          rsc_seniority: number | null;
        }>;
      }>;
      members: Array<{
        memberId: number;
        employeeId: string;
        name: string;
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
    expect(m?.memberId).toBe(1);
    expect(m?.employeeId).toBe('10001');
    expect(m?.name).toBe('Member1 Test');
    expect(m?.station).toBe('21');
    expect(m?.unit).toBe('Engine 21');

    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

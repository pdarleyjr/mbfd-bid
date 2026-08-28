import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'c'.repeat(64);
const AS_OF = '2026-08-28';

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

interface CurrentRosterResponse {
  asOf: string;
  administrativeAssignmentPolicy: {
    status: 'configured' | 'unconfigured';
    bidYear: number;
    ruleBookVersion: string | null;
  };
  positions: Array<{
    id: string;
    shift: string | null;
    station: string | null;
    unit: string | null;
    applicableRank: string | null;
    occupancy: 'occupied' | 'vacant';
    administrativeAssignment: boolean;
    assignment: { id: string; memberId: number; status: string } | null;
  }>;
  summary: {
    totalPositions: number;
    occupiedPositions: number;
    vacantPositions: number;
    administrativelyAssignedNonBiddablePositions: number;
  };
  unassignedMembers: Array<{ id: number }>;
}

describe('Current Roster admin projection', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    const now = Date.UTC(2026, 7, 28, 12, 0, 0);

    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at)
       VALUES
         (1, 'synthetic-1', 'Synthetic', 'One', 'FF', 'FF', 1, 0, ${now}, ${now}),
         (2, 'synthetic-2', 'Synthetic', 'Two', 'LT', 'OFC', 2, 0, ${now}, ${now}),
         (3, 'synthetic-3', 'Synthetic', 'Three', 'DC', 'OFC', 3, 0, ${now}, ${now});

       INSERT INTO staffing_positions
         (id, stable_slot_key, shift, station, unit, position_name, applicable_rank, active_from, review_status, created_at, updated_at)
       VALUES
         ('slot-a', 'SYNTHETIC/A/1/ENGINE', 'A', '1', 'Engine', 'Firefighter', 'FF', '2026-01-01', 'approved', ${now}, ${now}),
         ('slot-b', 'SYNTHETIC/A/2/LIEUTENANT', 'A', '2', 'Engine', 'Lieutenant', 'LT', '2026-01-01', 'approved', ${now}, ${now}),
         ('slot-b211', 'SYNTHETIC/B/2/DIVISION-CHIEF', 'B', '2', '300', 'Division Chief', 'DC', '2026-01-01', 'approved', ${now}, ${now});

       INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, effective_to, created_at, updated_at)
       VALUES
         ('assignment-a', 1, 'slot-a', 'ADMIN_TRANSFER', 'synthetic-adjustment-a', 'active', '2026-01-01', NULL, ${now}, ${now}),
         ('assignment-b-ended', 2, 'slot-b', 'ADMIN_TRANSFER', 'synthetic-adjustment-b', 'ended', '2026-01-01', '2026-03-31', ${now}, ${now}),
         ('assignment-b211', 3, 'slot-b211', 'ADMIN_TRANSFER', 'synthetic-adjustment-b211', 'active', '2026-01-01', NULL, ${now}, ${now});

        INSERT INTO bid_years (year, status, rule_book_version)
        VALUES (2026, 'configuring', '2026.synthetic');
       INSERT INTO position_templates (version, effective_year) VALUES ('2026.synthetic', 2026);
       INSERT INTO positions
         (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES ('B211', '2026.synthetic', 'B', '2', 'Combat', '300', 'DC', 'Division Chief');
       INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.synthetic', 2026, 'draft');
       INSERT INTO rule_book_position_participation
         (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
       VALUES
         ('2026.synthetic', 'B211', '2026.synthetic', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'synthetic-policy-direction', ${now});
       INSERT INTO position_staffing_bindings
         (position_id, template_version, staffing_position_id, authoritative_source_ref, review_status, created_at)
       VALUES
         ('B211', '2026.synthetic', 'slot-b211', 'synthetic-policy-direction', 'approved', ${now});
       UPDATE rule_books SET status = 'active' WHERE version = '2026.synthetic';`,
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('requires an administrator credential', async () => {
    const response = await app.fetch(new Request('http://x/api/admin/current-roster'), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(response.status).toBe(401);
  });

  it('projects authorized staffing slots, occupancy, vacancies, unassigned members, and reviewed non-biddable bindings without changing canonical data', async () => {
    const beforeAssignments = await h.db.run(
      'SELECT id, status FROM member_assignments ORDER BY id',
    );

    const response = await app.fetch(
      new Request(`http://x/api/admin/current-roster?as_of=${AS_OF}`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as CurrentRosterResponse;
    expect(body.asOf).toBe(AS_OF);
    expect(body.administrativeAssignmentPolicy).toEqual({
      status: 'configured',
      bidYear: 2026,
      ruleBookVersion: '2026.synthetic',
    });
    expect(body.summary).toEqual({
      totalPositions: 3,
      occupiedPositions: 2,
      vacantPositions: 1,
      administrativelyAssignedNonBiddablePositions: 1,
    });
    expect(body.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'slot-a',
          occupancy: 'occupied',
          administrativeAssignment: false,
          assignment: expect.objectContaining({
            id: 'assignment-a',
            memberId: 1,
            status: 'active',
          }),
        }),
        expect.objectContaining({
          id: 'slot-b',
          occupancy: 'vacant',
          administrativeAssignment: false,
          assignment: null,
        }),
        expect.objectContaining({
          id: 'slot-b211',
          occupancy: 'occupied',
          administrativeAssignment: true,
          assignment: expect.objectContaining({ id: 'assignment-b211', memberId: 3 }),
        }),
      ]),
    );
    expect(body.unassignedMembers).toEqual([expect.objectContaining({ id: 2 })]);

    const afterAssignments = await h.db.run(
      'SELECT id, status FROM member_assignments ORDER BY id',
    );
    expect(afterAssignments.results).toEqual(beforeAssignments.results);
  });

  it('uses the requested year designated rule book rather than global active-rule-book state', async () => {
    await h.db.run(
      `UPDATE rule_books SET status = 'archived' WHERE version = '2026.synthetic';
       INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.unrelated', 2026, 'draft');
       INSERT INTO rule_book_position_participation
         (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
       VALUES
         ('2026.unrelated', 'B211', '2026.synthetic', 'BIDDABLE', 'synthetic-unrelated-policy', 1);
       UPDATE rule_books SET status = 'active' WHERE version = '2026.unrelated';`,
    );

    const response = await app.fetch(
      new Request(`http://x/api/admin/current-roster?as_of=${AS_OF}`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as CurrentRosterResponse;
    expect(body.administrativeAssignmentPolicy).toEqual({
      status: 'configured',
      bidYear: 2026,
      ruleBookVersion: '2026.synthetic',
    });
    expect(body.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'slot-b211', administrativeAssignment: true }),
      ]),
    );
    expect(body.summary.administrativelyAssignedNonBiddablePositions).toBe(1);
  });

  it('reports an explicitly unconfigured policy instead of inferring from an active rule book', async () => {
    await h.db.run('UPDATE bid_years SET rule_book_version = NULL WHERE year = 2026');

    const response = await app.fetch(
      new Request(`http://x/api/admin/current-roster?as_of=${AS_OF}`, {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as CurrentRosterResponse;
    expect(body.administrativeAssignmentPolicy).toEqual({
      status: 'unconfigured',
      bidYear: 2026,
      ruleBookVersion: null,
    });
    expect(body.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'slot-b211', administrativeAssignment: false }),
      ]),
    );
    expect(body.summary.administrativelyAssignedNonBiddablePositions).toBe(0);
  });

  it('filters by shift, station, unit, and applicable rank without interpreting a vacancy as a Bid opportunity', async () => {
    const response = await app.fetch(
      new Request(
        `http://x/api/admin/current-roster?as_of=${AS_OF}&shift=A&station=2&unit=Engine&rank=LT`,
        { headers: { Authorization: `Bearer ${await adminJwt()}` } },
      ),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as CurrentRosterResponse;
    expect(body.positions).toEqual([
      expect.objectContaining({
        id: 'slot-b',
        shift: 'A',
        station: '2',
        unit: 'Engine',
        applicableRank: 'LT',
        occupancy: 'vacant',
        administrativeAssignment: false,
      }),
    ]);
    expect(body.summary.vacantPositions).toBe(1);
  });

  it('rejects malformed as-of values and returns assignment history only to administrators', async () => {
    const malformed = await app.fetch(
      new Request('http://x/api/admin/current-roster?as_of=2026-99-99', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(malformed.status).toBe(400);

    const history = await app.fetch(
      new Request('http://x/api/admin/current-roster/assignments/assignment-a/history', {
        headers: { Authorization: `Bearer ${await adminJwt()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      assignment: { id: 'assignment-a', memberId: 1, staffingPositionId: 'slot-a' },
      memberHistory: [expect.objectContaining({ id: 'assignment-a' })],
      positionHistory: [expect.objectContaining({ id: 'assignment-a' })],
    });
  });
});

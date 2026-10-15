import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { type TrainingRosterMember, trainingShift } from '../../src/lib/training-roster.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const TOKEN = 'synthetic-training-reader-only';

describe('training roster bridge', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(`INSERT INTO members
      (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, employment_status, created_at, updated_at)
      VALUES (1, '000123', 'Synthetic', 'Fixture', 'FF', 'FF', 1, 0, 'active', 1, 1);
      INSERT INTO staffing_positions
      (id, stable_slot_key, shift, station, unit, position_name, applicable_rank, active_from, review_status, created_at, updated_at)
      VALUES ('old-seat', 'synthetic/old', 'Days', '1', 'Engine', 'Captain', 'CPT', '2026-01-01', 'approved', 1, 1),
             ('new-seat', 'synthetic/new', 'D', '2', 'Engine', 'Lieutenant', 'LT', '2026-01-01', 'approved', 1, 1);
      INSERT INTO member_assignments
      (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, effective_to, created_at, updated_at)
      VALUES ('old-assignment', 1, 'old-seat', 'ADMIN_TRANSFER', 'synthetic/transfer', 'active', '2026-01-01', '2026-10-31', 1, 1),
             ('future-award', 1, 'new-seat', 'BID_AWARD', 'synthetic/award', 'planned', '2026-11-01', NULL, 1, 1);`);
  });
  afterEach(async () => teardownTestD1(h));

  async function request(asOf: string, token = TOKEN) {
    return app.fetch(
      new Request(`http://x/api/portal/training-roster?as_of=${asOf}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { ...h.env, PORTAL_BID_READER: TOKEN },
    );
  }

  it('requires the bridge credential', async () => {
    expect((await request('2026-10-15', 'wrong')).status).toBe(401);
    const response = await app.fetch(new Request('http://x/api/portal/training-roster'), {
      ...h.env,
      PORTAL_BID_READER: '',
    });
    expect(response.status).toBe(503);
  });

  it('uses the effective assignment rather than the future published award or seat rank', async () => {
    const response = await request('2026-10-15');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const payload = (await response.json()) as {
      members: TrainingRosterMember[];
      term_label: string | null;
    };
    expect(payload.term_label).toBeNull();
    expect(payload.members[0]).toMatchObject({
      employee_id: '000123',
      rank: 'Firefighter',
      shift: 'Days',
      assignment_id: 'old-assignment',
      eligible: true,
    });
    expect(payload.members[0]).not.toHaveProperty('credentials');
    const future = await request('2026-11-01');
    expect(((await future.json()) as { members: TrainingRosterMember[] }).members[0]).toMatchObject(
      { shift: 'D Shift', assignment_id: 'future-award' },
    );
  });

  it('preserves source protection against temporal overlaps', async () => {
    await expect(
      h.db.run(
        "UPDATE member_assignments SET effective_from = '2026-10-01' WHERE id = 'future-award'",
      ),
    ).rejects.toThrow('overlapping authoritative assignment for member');
    const response = await request('2026-10-15');
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { members: TrainingRosterMember[] }).members[0]?.assignment_id,
    ).toBe('old-assignment');
  });

  it('reports inactive personnel as ineligible and leaves unavailable assignments null', async () => {
    await h.db.run(
      "UPDATE members SET employment_status = 'inactive'; UPDATE member_assignments SET status = 'cancelled'",
    );
    const response = await request('2026-10-15');
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { members: TrainingRosterMember[] }).members[0],
    ).toMatchObject({ eligible: false, assignment_id: null, shift: null });
  });

  it('validates real calendar dates', async () => {
    expect((await request('2026-02-30')).status).toBe(400);
  });

  it('does not conflate Days with D Shift or guess an ambiguous label', () => {
    expect(trainingShift('Days')).toBe('Days');
    expect(trainingShift('D')).toBe('D Shift');
    expect(trainingShift('D Shift')).toBe('D Shift');
    expect(trainingShift('D / DAYS')).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import {
  isProtectedTenure,
  loadTenureAsOf,
  tenureParticipationIssues,
} from '../../src/lib/tenure-evidence.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
describe('dated tenure review and annual protection', () => {
  let h: TestD1;
  let token: string;
  const base = {
    staffing_position_id: 'synthetic-seat',
    expected_revision: 0,
    effective_on: '2026-08-01',
    status: 'PROTECTED',
    member_id: 100,
    protected_from: '2026-08-01',
    protected_through: '2027-07-31',
    source_ref: 'Synthetic reviewed term document',
    reason: 'Synthetic protection review',
  };
  const request = (body: unknown, key: string) =>
    app.fetch(
      new Request('http://x/api/admin/tenure-evidence', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      }),
      h.env,
    );
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(
      "INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (100,'synthetic-100','Synthetic','Member','FF','FF',1,0,1,1); INSERT INTO staffing_positions (id,stable_slot_key,division,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at) VALUES ('synthetic-seat','SYNTHETIC/SEAT','Days','D','Training','Training','Instructor','FF','2026-01-01','approved',1,1)",
    );
    token = await signJwt(
      {
        sub: 100,
        emp: 'synthetic-100',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });
  afterEach(async () => teardownTestD1(h));
  it('requires matching canonical holder and non-biddable participation only during the reviewed term', async () => {
    expect((await request(base, 'term')).status).toBe(201);
    const rows = await loadTenureAsOf(h.env.DB, '2027-01-01');
    expect(rows).toHaveLength(1);
    const record = rows[0];
    if (!record) throw new Error('Synthetic tenure record missing');
    expect(isProtectedTenure(record, '2026-07-31')).toBe(false);
    expect(isProtectedTenure(record, '2027-07-31')).toBe(true);
    expect(isProtectedTenure(record, '2027-08-01')).toBe(false);
    const input = {
      asOf: '2027-01-01',
      records: rows,
      bindings: [
        { positionId: 'D-1', staffingPositionId: 'synthetic-seat', reviewStatus: 'approved' },
      ],
      nonBiddablePositionIds: ['D-1'],
      assignments: [{ staffingPositionId: 'synthetic-seat', memberId: 100 }],
    };
    expect(tenureParticipationIssues(input)).toEqual([]);
    expect(tenureParticipationIssues({ ...input, nonBiddablePositionIds: [] })).toMatchObject([
      { code: 'protected_seat_cannot_be_biddable' },
    ]);
    expect(tenureParticipationIssues({ ...input, bindings: [] })).toMatchObject([
      { code: 'protected_seat_binding_required' },
    ]);
    expect(tenureParticipationIssues({ ...input, assignments: [] })).toMatchObject([
      { code: 'protected_holder_assignment_requires_review' },
    ]);
    expect(
      tenureParticipationIssues({
        ...input,
        assignments: [{ staffingPositionId: 'synthetic-seat', memberId: 101 }],
      }),
    ).toMatchObject([{ code: 'protected_holder_assignment_requires_review' }]);
    expect(
      tenureParticipationIssues({ ...input, asOf: '2027-08-01', nonBiddablePositionIds: [] }),
    ).toEqual([]);
    expect(await loadTenureAsOf(h.env.DB, '2026-07-31')).toEqual([]);
  });
  it('appends explicit unknown revisions and preserves exact retry, immutable history and source generation', async () => {
    const sourceBefore = await h.env.DB.prepare(
      'SELECT revision FROM annual_source_revision WHERE id=1',
    ).first<{ revision: number }>();
    if (!sourceBefore) throw new Error('Source generation missing');
    const before = sourceBefore.revision;
    const first = await request(base, 'first');
    expect(first.status).toBe(201);
    const saved = await first.json();
    expect(await (await request(base, 'first')).json()).toEqual({
      ...(saved as object),
      replayed: true,
    });
    expect((await request({ ...base, protected_through: '2029-07-31' }, 'first')).status).toBe(409);
    expect(
      (
        await request(
          {
            ...base,
            expected_revision: 1,
            effective_on: '2026-09-01',
            status: 'UNKNOWN',
            member_id: null,
            protected_from: null,
            protected_through: null,
          },
          'unknown',
        )
      ).status,
    ).toBe(201);
    expect((await request({ ...base, effective_on: '2026-10-01' }, 'stale')).status).toBe(409);
    expect((await request({ ...base, expected_revision: 2 }, 'backdated')).status).toBe(409);
    const records = await loadTenureAsOf(h.env.DB, '2026-10-01');
    expect(records).toMatchObject([{ status: 'UNKNOWN', revision: 2 }]);
    expect(
      tenureParticipationIssues({
        asOf: '2026-10-01',
        records,
        bindings: [
          { positionId: 'D-1', staffingPositionId: 'synthetic-seat', reviewStatus: 'approved' },
        ],
        nonBiddablePositionIds: [],
        assignments: [],
      }),
    ).toMatchObject([{ code: 'tenure_status_unknown' }]);
    expect((await loadTenureAsOf(h.env.DB, '2026-08-15'))[0]?.status).toBe('PROTECTED');
    expect(
      await h.env.DB.prepare('SELECT revision FROM annual_source_revision WHERE id=1').first(),
    ).toEqual({ revision: before + 2 });
    expect(() => h.sqlite.prepare('DELETE FROM staffing_tenure_evidence').run()).toThrow(
      /immutable/,
    );
  });
  it('rolls back failed audit and rejects invalid dates, identity and inconsistent term facts', async () => {
    h.failNextBatchAt(1);
    expect((await request(base, 'retry')).status).toBe(409);
    expect(await loadTenureAsOf(h.env.DB, '2027-01-01')).toEqual([]);
    expect((await request(base, 'retry')).status).toBe(201);
    expect(
      (await request({ ...base, staffing_position_id: 'missing' }, 'missing-seat')).status,
    ).toBe(409);
    expect(
      (await request({ ...base, expected_revision: 1, member_id: 999 }, 'missing-member')).status,
    ).toBe(409);
    expect((await request({ ...base, effective_on: '2026-02-30' }, 'bad-date')).status).toBe(400);
    expect((await request({ ...base, status: 'UNKNOWN' }, 'bad-unknown')).status).toBe(400);
    expect((await request({ ...base, protected_through: '2025-01-01' }, 'reversed')).status).toBe(
      400,
    );
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});

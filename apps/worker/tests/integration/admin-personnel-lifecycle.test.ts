import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'p'.repeat(64);
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

async function adminJwt(fresh = true): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      ...(fresh ? { fresh_auth_at: Math.floor(Date.now() / 1000) } : {}),
    },
    KEY,
  );
}

async function request(h: TestD1, path: string, options: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`http://x${path}`, options), { ...h.env, JWT_SIGNING_KEY: KEY });
}

describe('personnel lifecycle administration', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, employment_status, employment_status_effective_on,
          created_at, updated_at)
       VALUES
         (1, 'synthetic-001', 'Synthetic', 'Firefighter', 'FF', 'FF', 1, 0,
          'active', '2026-01-01', ${NOW}, ${NOW});

       INSERT INTO staffing_positions
         (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
          active_from, review_status, created_at, updated_at)
       VALUES
         ('slot-ff', 'SYNTHETIC/A/1/FF', 'A', '1', 'Engine', 'Firefighter', 'FF',
          '2026-01-01', 'approved', ${NOW}, ${NOW}),
         ('slot-lt', 'SYNTHETIC/A/1/LT', 'A', '1', 'Engine', 'Lieutenant', 'LT',
          '2026-01-01', 'approved', ${NOW}, ${NOW}),
         ('slot-vacant', 'SYNTHETIC/B/2/FF', 'B', '2', 'Engine', 'Firefighter', 'FF',
          '2026-01-01', 'approved', ${NOW}, ${NOW});

       INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status,
          effective_from, effective_to, created_at, updated_at)
       VALUES
         ('assignment-current', 1, 'slot-ff', 'ADMIN_TRANSFER', 'synthetic-baseline',
          'active', '2026-01-01', NULL, ${NOW}, ${NOW});`,
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('previews a permanent assignment change without writing D1 or changing an established session', async () => {
    const before = await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events');
    const response = await request(h, '/api/admin/personnel/changes/preview', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await adminJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'TRANSFER',
        member_id: 1,
        staffing_position_id: 'slot-vacant',
        effective_on: '2026-09-15',
        reason: 'Synthetic preview remains non-mutating.',
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      preview: true,
      vacancyImpact: 'KNOWN_VACANT',
      establishedBidSnapshotImpact: 'NONE',
    });
    expect(await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events')).toEqual(
      before,
    );
  });

  it('keeps a no-target lifecycle preview non-speculative about vacancy impact', async () => {
    const before = await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events');
    const response = await request(h, '/api/admin/personnel/changes/preview', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await adminJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'RETIREMENT',
        member_id: 1,
        effective_on: '2026-09-15',
        separation_type: 'Synthetic retirement preview.',
        reason: 'Synthetic preview remains non-mutating.',
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      preview: true,
      vacancyImpact: 'NOT_DETERMINED_BY_PERSONNEL_PREVIEW',
      establishedBidSnapshotImpact: 'NONE',
    });
    expect(await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events')).toEqual(
      before,
    );
  });

  it('keeps a Special Assignment as a non-mutating daily-vacancy overlay', async () => {
    const response = await request(h, '/api/admin/personnel/temporary-overlays/preview', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await adminJwt()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'SPECIAL_ASSIGNMENT',
        member_id: 1,
        underlying_assignment_id: 'assignment-current',
        underlying_position_id: 'slot-ff',
        temporary_position_id: 'staff-a',
        effective_on: '2026-09-15',
        planned_end_on: null,
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      underlyingBidAssignmentPreserved: true,
      aDayPreserved: true,
      memberRemainsBidEligible: true,
      dailyVacancy: { bidVacancy: false },
      temporaryDestinationStaffingCount: 'POLICY_PENDING',
    });
  });

  it('requires a fresh administrator step-up before a lifecycle mutation', async () => {
    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt(false)}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-step-up-001',
      },
      body: JSON.stringify({
        kind: 'PROMOTION',
        member_id: 1,
        staffing_position_id: 'slot-lt',
        rank_after: 'LT',
        effective_on: '2026-09-15',
        reason: 'Synthetic promotion requires step-up.',
      }),
    });

    expect(response.status).toBe(401);
  });

  it("records a future promotion while preserving today's member projection and assignment history", async () => {
    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-promotion-001',
      },
      body: JSON.stringify({
        kind: 'PROMOTION',
        member_id: 1,
        staffing_position_id: 'slot-lt',
        rank_after: 'LT',
        effective_on: '2026-09-15',
        reason: 'Synthetic promotion for operator acceptance.',
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { event: { kind: string; effectiveOn: string } };
    expect(body.event).toMatchObject({ kind: 'PROMOTION', effectiveOn: '2026-09-15' });

    const member = await h.db.run('SELECT rank, employment_status FROM members WHERE id = 1');
    expect(member.results).toEqual([{ rank: 'FF', employment_status: 'active' }]);

    const assignments = await h.db.run(
      `SELECT staffing_position_id, status, effective_from, effective_to
       FROM member_assignments WHERE member_id = 1 ORDER BY effective_from`,
    );
    expect(assignments.results).toEqual([
      {
        staffing_position_id: 'slot-ff',
        status: 'active',
        effective_from: '2026-01-01',
        effective_to: '2026-09-14',
      },
      {
        staffing_position_id: 'slot-lt',
        status: 'planned',
        effective_from: '2026-09-15',
        effective_to: null,
      },
    ]);

    const asOfToday = await h.db.run(
      `SELECT staffing_position_id
       FROM member_assignments
       WHERE member_id = 1
         AND status <> 'cancelled'
         AND effective_from <= '2026-08-28'
         AND (effective_to IS NULL OR effective_to >= '2026-08-28')`,
    );
    const asOfBoundary = await h.db.run(
      `SELECT staffing_position_id
       FROM member_assignments
       WHERE member_id = 1
         AND status <> 'cancelled'
         AND effective_from <= '2026-09-15'
         AND (effective_to IS NULL OR effective_to >= '2026-09-15')`,
    );
    expect(asOfToday.results).toEqual([{ staffing_position_id: 'slot-ff' }]);
    expect(asOfBoundary.results).toEqual([{ staffing_position_id: 'slot-lt' }]);

    const events = await h.db.run(
      `SELECT kind, effective_on, employment_status_before, employment_status_after,
              rank_before, rank_after, origin, actor_subject, before_state, after_state
       FROM personnel_lifecycle_events`,
    );
    expect(events.results).toHaveLength(1);
    expect(events.results[0]).toMatchObject({
      kind: 'PROMOTION',
      effective_on: '2026-09-15',
      employment_status_before: 'active',
      employment_status_after: 'active',
      rank_before: 'FF',
      rank_after: 'LT',
      origin: 'ADMIN',
      actor_subject: '0',
    });
    expect(String(events.results[0]?.before_state)).toContain('assignment-current');
    expect(String(events.results[0]?.after_state)).toContain('slot-lt');
  });

  it("keeps today's assignment in effect until a future transfer's exact boundary", async () => {
    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-transfer-boundary-001',
      },
      body: JSON.stringify({
        kind: 'TRANSFER',
        member_id: 1,
        staffing_position_id: 'slot-vacant',
        effective_on: '2026-09-15',
        reason: 'Synthetic future transfer boundary proof.',
      }),
    });
    expect(response.status).toBe(201);

    const assignments = await h.db.run(
      `SELECT staffing_position_id, status, effective_from, effective_to
       FROM member_assignments WHERE member_id = 1 ORDER BY effective_from, id`,
    );
    expect(assignments.results).toEqual([
      {
        staffing_position_id: 'slot-ff',
        status: 'active',
        effective_from: '2026-01-01',
        effective_to: '2026-09-14',
      },
      {
        staffing_position_id: 'slot-vacant',
        status: 'planned',
        effective_from: '2026-09-15',
        effective_to: null,
      },
    ]);

    const asOfToday = await h.db.run(
      `SELECT staffing_position_id
       FROM member_assignments
       WHERE member_id = 1
         AND status <> 'cancelled'
         AND effective_from <= '2026-08-28'
         AND (effective_to IS NULL OR effective_to >= '2026-08-28')`,
    );
    const asOfBoundary = await h.db.run(
      `SELECT staffing_position_id
       FROM member_assignments
       WHERE member_id = 1
         AND status <> 'cancelled'
         AND effective_from <= '2026-09-15'
         AND (effective_to IS NULL OR effective_to >= '2026-09-15')`,
    );
    expect(asOfToday.results).toEqual([{ staffing_position_id: 'slot-ff' }]);
    expect(asOfBoundary.results).toEqual([{ staffing_position_id: 'slot-vacant' }]);
  });

  it('retires a synthetic member by ending active work and retaining history', async () => {
    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-retirement-001',
      },
      body: JSON.stringify({
        kind: 'RETIREMENT',
        member_id: 1,
        separation_type: 'RETIREMENT',
        effective_on: '2026-08-28',
        reason: 'Synthetic retirement for operator acceptance.',
      }),
    });

    expect(response.status).toBe(201);
    const member = await h.db.run(
      `SELECT id, rank, employment_status, employment_status_effective_on, separation_type
       FROM members WHERE id = 1`,
    );
    expect(member.results).toEqual([
      {
        id: 1,
        rank: 'FF',
        employment_status: 'retired',
        employment_status_effective_on: '2026-08-28',
        separation_type: 'RETIREMENT',
      },
    ]);
    const assignment = await h.db.run(
      "SELECT status, effective_to FROM member_assignments WHERE id = 'assignment-current'",
    );
    expect(assignment.results).toEqual([{ status: 'ended', effective_to: '2026-08-27' }]);
    const event = await h.db.run(
      `SELECT employment_status_after, separation_type FROM personnel_lifecycle_events
       WHERE idempotency_key = 'synthetic-retirement-001'`,
    );
    expect(event.results).toEqual([
      { employment_status_after: 'retired', separation_type: 'RETIREMENT' },
    ]);
  });

  it("derives a future retirement only at its effective boundary instead of prematurely changing today's member projection", async () => {
    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-future-retirement-001',
      },
      body: JSON.stringify({
        kind: 'RETIREMENT',
        member_id: 1,
        separation_type: 'RETIREMENT',
        effective_on: '2026-09-15',
        reason: 'Synthetic future retirement projection proof.',
      }),
    });
    expect(response.status).toBe(201);

    const stored = await h.db.run('SELECT employment_status FROM members WHERE id = 1');
    expect(stored.results).toEqual([{ employment_status: 'active' }]);

    const before = await request(h, '/api/admin/personnel/members?as_of=2026-08-28', {
      headers: { Authorization: `Bearer ${await adminJwt()}` },
    });
    const after = await request(h, '/api/admin/personnel/members?as_of=2026-09-15', {
      headers: { Authorization: `Bearer ${await adminJwt()}` },
    });
    expect(before.status).toBe(200);
    expect(after.status).toBe(200);
    const beforeBody = (await before.json()) as { members: Array<{ employmentStatus: string }> };
    const afterBody = (await after.json()) as {
      members: Array<{ employmentStatus: string; separationType: string | null }>;
    };
    expect(beforeBody.members[0]).toMatchObject({ employmentStatus: 'active' });
    expect(afterBody.members[0]).toMatchObject({
      employmentStatus: 'retired',
      separationType: 'RETIREMENT',
    });
  });

  it('does not let a later personnel event implicitly reactivate a scheduled retiree', async () => {
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
    };
    const retirement = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'synthetic-retirement-before-promotion-001' },
      body: JSON.stringify({
        kind: 'RETIREMENT',
        member_id: 1,
        separation_type: 'RETIREMENT',
        effective_on: '2026-09-15',
        reason: 'Synthetic future retirement blocks later promotion.',
      }),
    });
    expect(retirement.status).toBe(201);

    const blockedPromotion = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'synthetic-post-retirement-promotion-001' },
      body: JSON.stringify({
        kind: 'PROMOTION',
        member_id: 1,
        staffing_position_id: 'slot-lt',
        rank_after: 'LT',
        effective_on: '2026-09-16',
        reason: 'This promotion must not reactivate a retired member.',
      }),
    });
    expect(blockedPromotion.status).toBe(422);
    await expect(blockedPromotion.json()).resolves.toMatchObject({ error: 'member_not_active' });

    const reactivation = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'synthetic-explicit-reactivation-001' },
      body: JSON.stringify({
        kind: 'REACTIVATION',
        member_id: 1,
        effective_on: '2026-10-01',
        reason: 'Synthetic explicit reactivation after retirement.',
      }),
    });
    expect(reactivation.status).toBe(201);

    const allowedPromotion = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'synthetic-post-reactivation-promotion-001' },
      body: JSON.stringify({
        kind: 'PROMOTION',
        member_id: 1,
        staffing_position_id: 'slot-lt',
        rank_after: 'LT',
        effective_on: '2026-10-02',
        reason: 'Synthetic promotion follows explicit reactivation.',
      }),
    });
    expect(allowedPromotion.status).toBe(201);
  });

  it('allows an explicit reviewed correction to classify an unknown legacy member', async () => {
    await h.db.run(
      "UPDATE members SET employment_status = 'unknown', employment_status_effective_on = NULL WHERE id = 1",
    );

    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-correction-001',
      },
      body: JSON.stringify({
        kind: 'CORRECTION',
        member_id: 1,
        rank_after: 'FF',
        employment_status_after: 'active',
        effective_on: '2026-08-28',
        reason: 'Synthetic reviewed correction classifies a legacy member.',
      }),
    });

    expect(response.status).toBe(201);
    expect(
      await h.db.run(
        'SELECT employment_status, employment_status_effective_on FROM members WHERE id = 1',
      ),
    ).toMatchObject({
      results: [{ employment_status: 'active', employment_status_effective_on: '2026-08-28' }],
    });
    expect(
      await h.db.run(
        "SELECT kind, employment_status_after FROM personnel_lifecycle_events WHERE idempotency_key = 'synthetic-correction-001'",
      ),
    ).toMatchObject({ results: [{ kind: 'CORRECTION', employment_status_after: 'active' }] });
  });

  it('creates a synthetic new hire and returns the original receipt for an exact idempotent retry', async () => {
    const payload = {
      kind: 'NEW_HIRE',
      new_member: {
        employee_id: 'synthetic-002',
        first_name: 'New',
        last_name: 'Synthetic',
        rank: 'FF',
        bid_category: 'FF',
        rsc_seniority: 2,
        rank_seniority: 2,
        hired_at: '2026-08-28',
      },
      staffing_position_id: 'slot-vacant',
      rank_after: 'FF',
      effective_on: '2026-08-28',
      reason: 'Synthetic new-hire onboarding for operator acceptance.',
    };
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-new-hire-001',
    };

    const created = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(created.status).toBe(201);

    const retry = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(retry.status).toBe(200);
    expect((await retry.json()) as { replayed: boolean }).toMatchObject({ replayed: true });

    const members = await h.db.run(
      "SELECT employee_id, employment_status FROM members WHERE employee_id = 'synthetic-002'",
    );
    expect(members.results).toEqual([
      { employee_id: 'synthetic-002', employment_status: 'active' },
    ]);
    const events = await h.db.run(
      "SELECT count(*) AS count FROM personnel_lifecycle_events WHERE idempotency_key = 'synthetic-new-hire-001'",
    );
    expect(events.results).toEqual([{ count: 1 }]);
  });

  it('onboards a civilian as an excluded non-bid person without inventing rank, seniority, or hire date', async () => {
    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-civilian-onboarding-001',
      },
      body: JSON.stringify({
        kind: 'NEW_HIRE',
        new_member: {
          employee_id: 'civilian-001',
          first_name: 'Civilian',
          last_name: 'Employee',
          rank: null,
          bid_category: 'EXCLUDED',
        },
        effective_on: '2026-09-04',
        reason: 'Owner-approved civilian roster tracking.',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      member: {
        employeeId: 'civilian-001',
        rank: null,
        bidCategory: 'EXCLUDED',
        rscSeniority: null,
        hiredAt: null,
      },
    });
    expect(
      await h.db.run(
        "SELECT rank,bid_category,rsc_seniority,rank_seniority,hired_at FROM members WHERE employee_id = 'civilian-001'",
      ),
    ).toMatchObject({
      results: [
        {
          rank: 'CIVILIAN',
          bid_category: 'EXCLUDED',
          rsc_seniority: 0,
          rank_seniority: null,
          hired_at: null,
        },
      ],
    });
    const evidence = await h.db.run(
      "SELECT rank_before,rank_after,after_state FROM personnel_lifecycle_events WHERE idempotency_key = 'synthetic-civilian-onboarding-001'",
    );
    expect(evidence.results[0]).toMatchObject({ rank_before: null, rank_after: null });
    expect(JSON.parse(String(evidence.results[0]?.after_state))).toMatchObject({
      rank: null,
      personnelClassification: 'CIVILIAN',
      rscSeniority: null,
      hiredAt: null,
    });
    const roster = await request(h, '/api/admin/personnel/members?as_of=2026-09-04', {
      headers: { Authorization: `Bearer ${await adminJwt()}` },
    });
    expect(roster.status).toBe(200);
    const rosterBody = (await roster.json()) as { members: Array<Record<string, unknown>> };
    expect(rosterBody.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeId: 'civilian-001',
          rank: null,
          personnelClassification: 'CIVILIAN',
          rscSeniority: null,
        }),
      ]),
    );
  });

  it('onboards an appointed excluded Division Chief without requiring bid seniority or a hire date', async () => {
    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-appointed-dc-onboarding-001',
      },
      body: JSON.stringify({
        kind: 'NEW_HIRE',
        new_member: {
          employee_id: 'appointed-dc-001',
          first_name: 'Appointed',
          last_name: 'Chief',
          rank: 'DC',
          bid_category: 'EXCLUDED',
        },
        effective_on: '2026-09-04',
        reason: 'Owner-approved appointed command roster tracking.',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      member: {
        employeeId: 'appointed-dc-001',
        rank: 'DC',
        bidCategory: 'EXCLUDED',
        rscSeniority: null,
        hiredAt: null,
      },
    });
    expect(
      await h.db.run(
        "SELECT rank,bid_category,rsc_seniority,hired_at FROM members WHERE employee_id = 'appointed-dc-001'",
      ),
    ).toMatchObject({
      results: [{ rank: 'DC', bid_category: 'EXCLUDED', rsc_seniority: 0, hired_at: null }],
    });
  });

  it('fails closed when a bidding member omits rank or seniority', async () => {
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-invalid-bidder-onboarding-001',
    };
    const missingRank = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind: 'NEW_HIRE',
        new_member: {
          employee_id: 'invalid-bidder-001',
          first_name: 'Invalid',
          last_name: 'Bidder',
          rank: null,
          bid_category: 'FF',
          rsc_seniority: 1,
        },
        effective_on: '2026-09-04',
        reason: 'Synthetic invalid bidder proof.',
      }),
    });
    expect(missingRank.status).toBe(400);

    const missingSeniority = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'synthetic-invalid-bidder-onboarding-002' },
      body: JSON.stringify({
        kind: 'NEW_HIRE',
        new_member: {
          employee_id: 'invalid-bidder-002',
          first_name: 'Invalid',
          last_name: 'Bidder',
          rank: 'FF',
          bid_category: 'FF',
        },
        effective_on: '2026-09-04',
        reason: 'Synthetic invalid bidder proof.',
      }),
    });
    expect(missingSeniority.status).toBe(400);
  });

  it('rejects a new-hire retry whose otherwise hidden onboarding state differs', async () => {
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-new-hire-state-conflict-001',
    };
    const original = {
      kind: 'NEW_HIRE',
      new_member: {
        employee_id: 'synthetic-003',
        first_name: 'Another',
        last_name: 'Synthetic',
        rank: 'FF',
        bid_category: 'FF',
        rsc_seniority: 3,
        rank_seniority: 3,
        hired_at: '2026-08-28',
      },
      staffing_position_id: 'slot-vacant',
      rank_after: 'FF',
      effective_on: '2026-08-28',
      reason: 'Synthetic new-hire idempotency state proof.',
    };
    expect(
      (
        await request(h, '/api/admin/personnel/changes', {
          method: 'POST',
          headers,
          body: JSON.stringify(original),
        })
      ).status,
    ).toBe(201);

    const reused = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...original,
        new_member: { ...original.new_member, rank_seniority: 4 },
      }),
    });
    expect(reused.status).toBe(409);
  });

  it('rejects a mismatched request that reuses an idempotency key', async () => {
    const headers = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-idempotency-conflict-001',
    };
    const original = {
      kind: 'PROMOTION',
      member_id: 1,
      staffing_position_id: 'slot-lt',
      rank_after: 'LT',
      effective_on: '2026-09-15',
      reason: 'Synthetic promotion idempotency proof.',
    };
    const accepted = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers,
      body: JSON.stringify(original),
    });
    expect(accepted.status).toBe(201);

    const reused = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...original,
        reason: 'Different synthetic request using the same key.',
      }),
    });
    expect(reused.status).toBe(409);
    expect(
      await h.db.run(
        "SELECT count(*) AS count FROM personnel_lifecycle_events WHERE idempotency_key = 'synthetic-idempotency-conflict-001'",
      ),
    ).toMatchObject({ results: [{ count: 1 }] });
  });

  it('records staffing-position creation and retirement as immutable lifecycle events', async () => {
    const createPayload = {
      kind: 'POSITION_CREATE',
      effective_on: '2026-09-01',
      reason: 'Synthetic staffing-position creation proof.',
      staffing_position: {
        id: 'slot-created',
        stable_slot_key: 'SYNTHETIC/C/3/FF',
        review_status: 'approved',
        shift: 'C',
        station: '3',
        position_name: 'Synthetic Firefighter',
      },
    };
    const createHeaders = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-position-create-001',
    };
    const create = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify(createPayload),
    });
    expect(create.status).toBe(201);
    expect(
      await h.db.run("SELECT review_status FROM staffing_positions WHERE id = 'slot-created'"),
    ).toMatchObject({ results: [{ review_status: 'approved' }] });

    const conflictedRetry = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: createHeaders,
      body: JSON.stringify({
        ...createPayload,
        staffing_position: { ...createPayload.staffing_position, shift: 'D' },
      }),
    });
    expect(conflictedRetry.status).toBe(409);

    const retire = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-position-retire-001',
      },
      body: JSON.stringify({
        kind: 'POSITION_RETIRE',
        staffing_position_id: 'slot-vacant',
        effective_on: '2026-09-01',
        reason: 'Synthetic staffing-position retirement proof.',
      }),
    });
    expect(retire.status).toBe(201);
    expect(
      await h.db.run(
        "SELECT review_status, active_to FROM staffing_positions WHERE id = 'slot-vacant'",
      ),
    ).toMatchObject({ results: [{ review_status: 'retired', active_to: '2026-08-31' }] });
    expect(
      await h.db.run(
        "SELECT kind FROM personnel_lifecycle_events WHERE kind LIKE 'POSITION_%' ORDER BY kind",
      ),
    ).toMatchObject({ results: [{ kind: 'POSITION_CREATE' }, { kind: 'POSITION_RETIRE' }] });
  });

  it('returns complete member lifecycle and assignment history without a mutating read', async () => {
    const mutation = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-history-001',
      },
      body: JSON.stringify({
        kind: 'RETIREMENT',
        member_id: 1,
        separation_type: 'RETIREMENT',
        effective_on: '2026-08-28',
        reason: 'Synthetic retirement history proof.',
      }),
    });
    expect(mutation.status).toBe(201);

    const response = await request(h, '/api/admin/personnel/members/1/history', {
      headers: { Authorization: `Bearer ${await adminJwt()}` },
    });
    expect(response.status).toBe(200);
    const history = (await response.json()) as {
      member: { id: number; employmentStatus: string };
      lifecycleEvents: Array<{ kind: string; effectiveOn: string }>;
      assignments: Array<{ id: string; status: string }>;
    };
    expect(history.member).toMatchObject({ id: 1, employmentStatus: 'retired' });
    expect(history.lifecycleEvents).toEqual([
      expect.objectContaining({ kind: 'RETIREMENT', effectiveOn: '2026-08-28' }),
    ]);
    expect(history.assignments).toEqual([
      expect.objectContaining({ id: 'assignment-current', status: 'ended' }),
    ]);
  });

  it('rejects a non-correction that attempts to supersede a lifecycle event before mutation', async () => {
    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-supersede-non-correction-001',
      },
      body: JSON.stringify({
        kind: 'TRANSFER',
        member_id: 1,
        staffing_position_id: 'slot-vacant',
        effective_on: '2026-09-15',
        reason: 'Synthetic non-correction supersession must be rejected.',
        supersedes_event_id: 'synthetic-prior-event',
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'supersedes_event_correction_only' });
    expect(
      await h.db.run('SELECT count(*) AS count FROM personnel_lifecycle_events'),
    ).toMatchObject({ results: [{ count: 0 }] });
    expect(await h.db.run('SELECT count(*) AS count FROM member_assignments')).toMatchObject({
      results: [{ count: 1 }],
    });
  });

  it("rejects a correction that attempts to supersede another member's event before mutation", async () => {
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, employment_status, employment_status_effective_on,
          created_at, updated_at)
       VALUES
         (2, 'synthetic-002', 'Other', 'Synthetic', 'FF', 'FF', 2, 0,
          'active', '2026-01-01', ${NOW}, ${NOW});

       INSERT INTO personnel_lifecycle_events
         (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
          employment_status_before, employment_status_after, rank_before, rank_after,
          separation_type, reason, origin, actor_subject, idempotency_key,
          before_state, after_state, supersedes_event_id, created_at)
       VALUES
         ('synthetic-other-member-event', 2, NULL, NULL, 'PROMOTION', '2026-08-28',
          'active', 'active', 'FF', 'LT', NULL, 'Synthetic source event for another member.',
          'ADMIN', 'synthetic-admin', 'synthetic-other-member-event-001',
          '{"memberId":2,"rank":"FF"}', '{"memberId":2,"rank":"LT"}', NULL, ${NOW});`,
    );

    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-cross-member-correction-001',
      },
      body: JSON.stringify({
        kind: 'CORRECTION',
        member_id: 1,
        rank_after: 'FF',
        employment_status_after: 'active',
        effective_on: '2026-08-28',
        reason: 'Synthetic correction must retain the same member evidence.',
        supersedes_event_id: 'synthetic-other-member-event',
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'superseded_event_member_mismatch' });
    expect(
      await h.db.run(
        'SELECT count(*) AS count FROM personnel_lifecycle_events WHERE member_id = 1',
      ),
    ).toMatchObject({ results: [{ count: 0 }] });
  });

  it('rejects a correction that names a target incompatible with its superseded event', async () => {
    await h.db.run(
      `INSERT INTO personnel_lifecycle_events
         (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
          employment_status_before, employment_status_after, rank_before, rank_after,
          separation_type, reason, origin, actor_subject, idempotency_key,
          before_state, after_state, supersedes_event_id, created_at)
       VALUES
         ('synthetic-slot-ff-event', 1, 'slot-ff', 'assignment-current', 'PROMOTION', '2026-08-28',
          'active', 'active', 'FF', 'LT', NULL, 'Synthetic source event for target compatibility.',
          'ADMIN', 'synthetic-admin', 'synthetic-slot-ff-event-001',
          '{"memberId":1,"staffingPositionId":"slot-ff"}',
          '{"memberId":1,"staffingPositionId":"slot-ff"}', NULL, ${NOW});`,
    );

    const response = await request(h, '/api/admin/personnel/changes', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await adminJwt()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'synthetic-cross-target-correction-001',
      },
      body: JSON.stringify({
        kind: 'CORRECTION',
        member_id: 1,
        staffing_position_id: 'slot-vacant',
        rank_after: 'FF',
        employment_status_after: 'active',
        effective_on: '2026-09-15',
        reason: 'Synthetic correction must retain compatible target evidence.',
        supersedes_event_id: 'synthetic-slot-ff-event',
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'superseded_event_target_mismatch' });
    expect(await h.db.run('SELECT count(*) AS count FROM member_assignments')).toMatchObject({
      results: [{ count: 1 }],
    });
  });

  it('retains the underlying assignment while an overlay is active and restores it through an idempotent end receipt', async () => {
    const auth = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
    };
    const created = await request(h, '/api/admin/personnel/temporary-overlays', {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': 'synthetic-overlay-001' },
      body: JSON.stringify({
        kind: 'SPECIAL_ASSIGNMENT',
        member_id: 1,
        underlying_assignment_id: 'assignment-current',
        temporary_position_id: 'temporary-command-staff',
        effective_on: '2026-08-28',
        planned_end_on: null,
        provenance: 'synthetic overlay acceptance evidence',
      }),
    });
    expect(created.status).toBe(201);
    const { overlayId } = (await created.json()) as { overlayId: string };

    const detail = await request(h, `/api/admin/personnel/temporary-overlays/${overlayId}`, {
      headers: auth,
    });
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      overlay: expect.objectContaining({
        kind: 'SPECIAL_ASSIGNMENT',
        underlying_assignment_id: 'assignment-current',
        underlying_position_id: 'slot-ff',
      }),
      underlyingBidAssignmentPreserved: true,
      aDayPreserved: true,
      dailyStaffingVacancy: true,
      annualBidVacancy: false,
      destinationStaffing: 'POLICY_PENDING',
    });

    const end = await request(h, `/api/admin/personnel/temporary-overlays/${overlayId}/end`, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': 'synthetic-overlay-end-001' },
      body: JSON.stringify({ actual_end_on: '2026-08-29' }),
    });
    expect(end.status).toBe(200);
    await expect(end.json()).resolves.toMatchObject({
      replayed: false,
      operationalAssignment: 'UNDERLYING_ASSIGNMENT_RESTORED',
    });

    const replay = await request(h, `/api/admin/personnel/temporary-overlays/${overlayId}/end`, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': 'synthetic-overlay-end-001' },
      body: JSON.stringify({ actual_end_on: '2026-08-29' }),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      replayed: true,
      annualBidAssignment: 'UNCHANGED',
    });
    expect(
      await h.db.run(
        "SELECT status,effective_to FROM member_assignments WHERE id = 'assignment-current'",
      ),
    ).toMatchObject({ results: [{ status: 'active', effective_to: null }] });
  });
});

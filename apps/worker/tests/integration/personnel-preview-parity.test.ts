import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'f'.repeat(64);
const NOW = Date.UTC(2026, 7, 28, 12);
const CHANGE = {
  kind: 'TRANSFER',
  member_id: 1,
  staffing_position_id: 'slot-target',
  effective_on: '2026-09-15',
  reason: 'Synthetic reviewed transfer',
};

interface PreviewResponse {
  current: {
    member: { rank: string; employmentStatus: string };
    assignments: Array<{ id: string }>;
  };
  proposed: {
    event: { beforeState: Record<string, unknown>; afterState: Record<string, unknown> };
    assignmentCreation: {
      staffingPositionId: string;
      effectiveFrom: string;
      status: string;
    } | null;
    assignmentClosures: Array<{ id: string; effectiveTo: string; status: string }>;
  };
  vacancyImpact: string;
}

describe('personnel preview and commit authority parity', () => {
  let h: TestD1;

  function snapshot() {
    return createHash('sha256').update(h.sqlite.serialize()).digest('hex');
  }
  let token: string;

  async function request(body: Record<string, unknown>, preview = true, key = 'synthetic-commit') {
    return app.fetch(
      new Request(`http://x/api/admin/personnel/changes${preview ? '/preview' : ''}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(!preview ? { 'Idempotency-Key': key } : {}),
        },
        body: JSON.stringify(body),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
  }

  async function assertRejectedEqually(
    body: Record<string, unknown>,
    status: number,
    error: string,
  ) {
    const before = snapshot();
    const preview = await request(body);
    expect(preview.status).toBe(status);
    expect(await preview.json()).toMatchObject({ error });
    const commit = await request(body, false, `rejected-${error}`);
    expect(commit.status).toBe(status);
    expect(await commit.json()).toMatchObject({ error });
    expect(snapshot()).toEqual(before);
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    h = await setupTestD1();
    token = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(NOW / 1000),
      },
      KEY,
    );
    await h.db.run(`
      INSERT INTO members
        (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, employment_status, created_at, updated_at)
      VALUES
        (1, 'synthetic-one', 'Synthetic', 'One', 'FF', 'FF', 1, 'active', ${NOW}, ${NOW}),
        (2, 'synthetic-two', 'Synthetic', 'Two', 'FF', 'FF', 2, 'active', ${NOW}, ${NOW});
      INSERT INTO staffing_positions
        (id, stable_slot_key, shift, station, unit, applicable_rank, active_from, active_to, review_status, created_at, updated_at)
      VALUES
        ('slot-current', 'SYNTHETIC/A/1', 'A', '1', 'Engine 1', 'FF', '2026-01-01', NULL, 'approved', ${NOW}, ${NOW}),
        ('slot-target', 'SYNTHETIC/E/7', 'E', '7', 'Engine 7', 'FF', '2026-01-01', NULL, 'approved', ${NOW}, ${NOW}),
        ('slot-occupied', 'SYNTHETIC/A/2', 'A', '2', 'Engine 2', 'FF', '2026-01-01', NULL, 'approved', ${NOW}, ${NOW}),
        ('slot-retired', 'SYNTHETIC/A/3', 'A', '3', 'Engine 3', 'FF', '2026-01-01', '2026-08-31', 'retired', ${NOW}, ${NOW}),
        ('slot-future', 'SYNTHETIC/E/8', 'E', '8', 'Engine 8', 'FF', '2027-01-01', NULL, 'approved', ${NOW}, ${NOW});
      INSERT INTO member_assignments
        (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, created_at, updated_at)
      VALUES
        ('assignment-current', 1, 'slot-current', 'ADMIN_TRANSFER', 'synthetic-source', 'active', '2026-01-01', ${NOW}, ${NOW}),
        ('assignment-occupied', 2, 'slot-occupied', 'ADMIN_TRANSFER', 'synthetic-source', 'active', '2026-01-01', ${NOW}, ${NOW}),
        ('assignment-cancelled', 1, 'slot-target', 'ADMIN_TRANSFER', 'synthetic-cancelled', 'cancelled', '2026-01-01', ${NOW}, ${NOW});
    `);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await teardownTestD1(h);
  });

  it('uses historical rank before the first ledger event for current and proposed member facts', async () => {
    await h.db.run(`
      UPDATE members SET rank='LT' WHERE id=1;
      INSERT INTO personnel_lifecycle_events
        (id, member_id, kind, effective_on, employment_status_before, employment_status_after,
         rank_before, rank_after, reason, origin, actor_subject, idempotency_key, before_state, after_state, created_at)
      VALUES ('synthetic-promotion', 1, 'PROMOTION', '2026-08-01', 'active', 'active', 'FF', 'LT',
        'Synthetic promotion history', 'ADMIN', 'synthetic-admin', 'synthetic-promotion',
        '{"rank":"FF","employmentStatus":"active"}', '{"rank":"LT","employmentStatus":"active"}', ${NOW});
    `);
    const before = snapshot();
    const response = await request({
      kind: 'CORRECTION',
      member_id: 1,
      rank_after: 'FF',
      employment_status_after: 'active',
      effective_on: '2026-07-31',
      reason: 'Synthetic historical correction preview',
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as PreviewResponse;
    expect(body.current.member.rank).toBe('FF');
    expect(body.proposed.event.beforeState.rank).toBe('FF');
    expect(body.proposed.event.afterState.rank).toBe('FF');
    expect(snapshot()).toEqual(before);
  });

  it('rejects future work after a scheduled retirement with the same authoritative error as commit', async () => {
    await h.db.run(`
      UPDATE member_assignments SET effective_to='2026-08-31' WHERE id='assignment-current';
      INSERT INTO personnel_lifecycle_events
        (id, member_id, kind, effective_on, employment_status_before, employment_status_after,
         rank_before, rank_after, separation_type, reason, origin, actor_subject, idempotency_key, before_state, after_state, created_at)
      VALUES ('synthetic-retirement', 1, 'RETIREMENT', '2026-09-01', 'active', 'retired', 'FF', 'FF',
        'RETIREMENT', 'Synthetic future retirement', 'ADMIN', 'synthetic-admin', 'synthetic-retirement',
        '{"rank":"FF","employmentStatus":"active"}', '{"rank":"FF","employmentStatus":"retired"}', ${NOW});
    `);
    await assertRejectedEqually(CHANGE, 422, 'member_not_active');
  });

  it('rejects missing, occupied, retired and not-yet-active targets with commit error/status parity', async () => {
    for (const [target, status, error] of [
      ['missing', 404, 'staffing_position_not_found'],
      ['slot-occupied', 409, 'staffing_position_occupied'],
      ['slot-retired', 409, 'staffing_position_unavailable'],
      ['slot-future', 409, 'staffing_position_unavailable'],
    ] as const) {
      await assertRejectedEqually({ ...CHANGE, staffing_position_id: target }, status, error);
    }
  });

  it('applies correction-only, same-member and compatible-target supersession guards before preview', async () => {
    await h.db.run(`
      INSERT INTO personnel_lifecycle_events
        (id, member_id, staffing_position_id, kind, effective_on, employment_status_before, employment_status_after,
         rank_before, rank_after, reason, origin, actor_subject, idempotency_key, before_state, after_state, created_at)
      VALUES
        ('event-one', 1, 'slot-current', 'CORRECTION', '2026-08-01', 'active', 'active', 'FF', 'FF',
         'Synthetic retained member history', 'ADMIN', 'synthetic-admin', 'event-one', '{"rank":"FF","employmentStatus":"active"}', '{"rank":"FF","employmentStatus":"active"}', ${NOW}),
        ('event-two', 2, 'slot-occupied', 'CORRECTION', '2026-08-01', 'active', 'active', 'FF', 'FF',
         'Synthetic retained other history', 'ADMIN', 'synthetic-admin', 'event-two', '{"rank":"FF","employmentStatus":"active"}', '{"rank":"FF","employmentStatus":"active"}', ${NOW});
    `);
    await assertRejectedEqually(
      { ...CHANGE, supersedes_event_id: 'event-one' },
      422,
      'supersedes_event_correction_only',
    );
    const correction = {
      kind: 'CORRECTION',
      member_id: 1,
      rank_after: 'FF',
      employment_status_after: 'active',
      effective_on: CHANGE.effective_on,
      reason: CHANGE.reason,
    };
    await assertRejectedEqually(
      { ...correction, supersedes_event_id: 'missing-event' },
      422,
      'supersedes_event_not_found',
    );
    await assertRejectedEqually(
      { ...correction, supersedes_event_id: 'event-two' },
      422,
      'superseded_event_member_mismatch',
    );
    await assertRejectedEqually(
      { ...correction, staffing_position_id: 'slot-target', supersedes_event_id: 'event-one' },
      422,
      'superseded_event_target_mismatch',
    );
  });

  it('returns matching input errors and preserves unsupported preview boundaries', async () => {
    await assertRejectedEqually(
      { ...CHANGE, effective_on: '2026-02-30' },
      400,
      'invalid_effective_on',
    );
    const { member_id: _memberId, ...withoutMember } = CHANGE;
    await assertRejectedEqually(withoutMember, 400, 'member_id_required');
    const before = snapshot();
    const unsupported = await request({
      kind: 'NEW_HIRE',
      effective_on: CHANGE.effective_on,
      reason: CHANGE.reason,
    });
    expect(unsupported.status).toBe(422);
    expect(await unsupported.json()).toMatchObject({
      error: 'preview_requires_supported_member_change',
    });
    expect(snapshot()).toEqual(before);
  });

  it('previews retirement without writes, retains cancelled history, then saves with the existing receipt', async () => {
    const retirement = {
      kind: 'POSITION_RETIRE',
      staffing_position_id: 'slot-target',
      effective_on: CHANGE.effective_on,
      reason: CHANGE.reason,
    };
    const before = snapshot();
    const preview = await request(retirement);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      preview: true,
      impact: {
        target: { id: 'slot-target', kind: 'POSITION' },
        effectiveOn: '2026-09-15',
        lastActiveOn: '2026-09-14',
        retirementBlocked: false,
        blockers: [],
        retainsHistory: true,
        assignments: [{ id: 'assignment-cancelled', status: 'cancelled' }],
      },
    });
    expect(snapshot()).toEqual(before);
    const commit = await request(retirement, false, 'retire-reviewed');
    expect(commit.status).toBe(201);
    expect(await commit.json()).toMatchObject({
      replayed: false,
      event: { kind: 'POSITION_RETIRE' },
    });
    const saved = snapshot();
    const replay = await request(retirement, false, 'retire-reviewed');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      replayed: true,
      event: { kind: 'POSITION_RETIRE' },
    });
    expect(snapshot()).toEqual(saved);
  });

  it('shows occupied retirement blockers and rejects commit without changing history', async () => {
    const retirement = {
      kind: 'POSITION_RETIRE',
      staffing_position_id: 'slot-current',
      effective_on: CHANGE.effective_on,
      reason: CHANGE.reason,
    };
    const before = snapshot();
    const preview = await request(retirement);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      impact: {
        retirementBlocked: true,
        blockers: [{ code: 'position_occupied_requires_vacancy', recordId: 'assignment-current' }],
      },
    });
    const commit = await request(retirement, false, 'retire-occupied');
    expect(commit.status).toBe(409);
    expect(await commit.json()).toMatchObject({ error: 'position_occupied_requires_vacancy' });
    expect(snapshot()).toEqual(before);
  });

  it('rechecks future assignment authority at retirement commit after a clear preview', async () => {
    const retirement = {
      kind: 'POSITION_RETIRE',
      staffing_position_id: 'slot-target',
      effective_on: CHANGE.effective_on,
      reason: CHANGE.reason,
    };
    const preview = await request(retirement);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ impact: { retirementBlocked: false } });
    await h.db.run(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,employment_status,created_at,updated_at)
        VALUES (3,'synthetic-future','Synthetic','Future','FF','FF',3,'active',${NOW},${NOW});
      INSERT INTO member_assignments (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,created_at,updated_at)
        VALUES ('assignment-later',3,'slot-target','ADMIN_TRANSFER','synthetic-later','planned','2026-10-01',${NOW},${NOW});
    `);
    const beforeCommit = snapshot();
    const commit = await request(retirement, false, 'retire-now-blocked');
    expect(commit.status).toBe(409);
    expect(await commit.json()).toMatchObject({
      error: 'position_authorization_invalidates_assignment',
    });
    expect(snapshot()).toEqual(beforeCommit);
  });

  it('excludes cancelled assignments, writes no preview state, then commits the same reviewed semantics', async () => {
    const before = snapshot();
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    const readonly = vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql: string) => {
      if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql))
        throw new Error('Preview attempted a database mutation');
      return prepare(sql);
    });
    const response = await request(CHANGE);
    expect(response.status).toBe(200);
    const preview = (await response.json()) as PreviewResponse;
    expect(preview.current.assignments.map((assignment) => assignment.id)).toEqual([
      'assignment-current',
    ]);
    expect(preview.vacancyImpact).toBe('KNOWN_VACANT');
    expect(snapshot()).toEqual(before);
    readonly.mockRestore();
    const committed = await request(CHANGE, false);
    expect(committed.status).toBe(201);
    const receipt = (await committed.json()) as {
      event: { beforeState: unknown; afterState: unknown };
    };
    expect(receipt.event.beforeState).toEqual(preview.proposed.event.beforeState);
    expect(receipt.event.afterState).toEqual(preview.proposed.event.afterState);
    expect(
      h.sqlite
        .prepare(
          "SELECT status,effective_to AS effectiveTo FROM member_assignments WHERE id='assignment-current'",
        )
        .get(),
    ).toEqual({ status: 'active', effectiveTo: '2026-09-14' });
    expect(
      h.sqlite
        .prepare(
          "SELECT staffing_position_id AS staffingPositionId,effective_from AS effectiveFrom,status FROM member_assignments WHERE member_id=1 AND id NOT IN ('assignment-current','assignment-cancelled')",
        )
        .get(),
    ).toEqual(
      preview.proposed.assignmentCreation === null
        ? null
        : {
            staffingPositionId: preview.proposed.assignmentCreation.staffingPositionId,
            effectiveFrom: preview.proposed.assignmentCreation.effectiveFrom,
            status: preview.proposed.assignmentCreation.status,
          },
    );
  });
});

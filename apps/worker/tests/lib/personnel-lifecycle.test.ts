import { describe, expect, it } from 'vitest';

import {
  type PersonnelLifecycleInput,
  derivePersonnelMemberAsOf,
  planPersonnelLifecycleChange,
} from '../../src/lib/personnel-lifecycle.js';

const member = {
  id: 101,
  employeeId: 'synthetic-101',
  firstName: 'Synthetic',
  lastName: 'Member',
  rank: 'FF' as const,
  employmentStatus: 'active' as const,
  employmentStatusEffectiveOn: '2026-01-01',
  separationType: null,
};

const activeAssignment = {
  id: 'assignment-current',
  memberId: 101,
  staffingPositionId: 'slot-firefighter',
  status: 'active' as const,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};

function request(overrides: Partial<PersonnelLifecycleInput> = {}): PersonnelLifecycleInput {
  return {
    kind: 'PROMOTION',
    effectiveOn: '2026-09-15',
    reason: 'Synthetic promotion for operator acceptance.',
    actorSubject: 'synthetic-admin',
    idempotencyKey: 'synthetic-promotion-001',
    member,
    activeAssignments: [activeAssignment],
    rankAfter: 'LT',
    staffingPositionId: 'slot-lieutenant',
    nowOn: '2026-08-28',
    ...overrides,
  };
}

describe('personnel lifecycle planning', () => {
  it('derives the member state at the requested effective date from immutable lifecycle evidence', () => {
    const events = [
      {
        id: 'retirement',
        kind: 'RETIREMENT' as const,
        effectiveOn: '2026-09-15',
        employmentStatusAfter: 'retired' as const,
        rankAfter: 'FF' as const,
        separationType: 'RETIREMENT',
        beforeState: {
          employmentStatus: 'active',
          employmentStatusEffectiveOn: '2020-01-01',
          separationType: null,
          rank: 'FF',
        },
        createdAt: 10,
      },
      {
        id: 'reactivation',
        kind: 'REACTIVATION' as const,
        effectiveOn: '2026-10-01',
        employmentStatusAfter: 'active' as const,
        rankAfter: 'FF' as const,
        separationType: null,
        beforeState: {},
        createdAt: 20,
      },
      {
        id: 'promotion',
        kind: 'PROMOTION' as const,
        effectiveOn: '2026-10-15',
        employmentStatusAfter: 'active' as const,
        rankAfter: 'LT' as const,
        separationType: null,
        beforeState: {},
        createdAt: 30,
      },
    ];

    expect(derivePersonnelMemberAsOf(member, events, '2026-09-14')).toMatchObject({
      employmentStatus: 'active',
      rank: 'FF',
      separationType: null,
    });
    expect(derivePersonnelMemberAsOf(member, events, '2026-09-15')).toMatchObject({
      employmentStatus: 'retired',
      rank: 'FF',
      separationType: 'RETIREMENT',
    });
    expect(derivePersonnelMemberAsOf(member, events, '2026-10-20')).toMatchObject({
      employmentStatus: 'active',
      rank: 'LT',
      separationType: null,
    });
  });

  it("plans a future promotion without rewriting today's member projection or historical assignment", () => {
    const planned = planPersonnelLifecycleChange(request());

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.memberProjection).toBeNull();
    expect(planned.assignmentClosures).toEqual([
      {
        id: 'assignment-current',
        status: 'active',
        effectiveTo: '2026-09-14',
      },
    ]);
    expect(planned.assignmentCreation).toMatchObject({
      memberId: 101,
      staffingPositionId: 'slot-lieutenant',
      originType: 'PROMOTION',
      status: 'planned',
      effectiveFrom: '2026-09-15',
    });
    expect(planned.event.afterState).toMatchObject({
      employmentStatus: 'active',
      rank: 'LT',
      staffingPositionId: 'slot-lieutenant',
    });
  });

  it('closes active work and records a retirement without deleting the member', () => {
    const retirement: PersonnelLifecycleInput = {
      kind: 'RETIREMENT',
      effectiveOn: '2026-08-28',
      reason: 'Synthetic retirement for operator acceptance.',
      actorSubject: 'synthetic-admin',
      idempotencyKey: 'synthetic-retirement-001',
      member,
      activeAssignments: [activeAssignment],
      separationType: 'RETIREMENT',
      nowOn: '2026-08-28',
    };
    const planned = planPersonnelLifecycleChange(retirement);

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.memberProjection).toEqual({
      employmentStatus: 'retired',
      employmentStatusEffectiveOn: '2026-08-28',
      separationType: 'RETIREMENT',
      rank: 'FF',
    });
    expect(planned.assignmentCreation).toBeNull();
    expect(planned.assignmentClosures).toEqual([
      {
        id: 'assignment-current',
        status: 'ended',
        effectiveTo: '2026-08-27',
      },
    ]);
    expect(planned.event.afterState).toMatchObject({
      employmentStatus: 'retired',
      separationType: 'RETIREMENT',
      assignment: null,
    });
  });

  it('rejects a separation that does not state its separation type', () => {
    const separation: PersonnelLifecycleInput = {
      kind: 'SEPARATION',
      effectiveOn: '2026-09-15',
      reason: 'Synthetic separation requires a recorded type.',
      actorSubject: 'synthetic-admin',
      idempotencyKey: 'synthetic-separation-001',
      member,
      activeAssignments: [activeAssignment],
      nowOn: '2026-08-28',
    };
    const planned = planPersonnelLifecycleChange(separation);

    expect(planned).toEqual({
      ok: false,
      error: 'separation_type_required',
    });
  });

  it('rejects malformed calendar dates and missing operator rationale before any mutation plan exists', () => {
    expect(
      planPersonnelLifecycleChange(
        request({
          effectiveOn: '2026-02-30',
          idempotencyKey: 'synthetic-invalid-date-001',
        }),
      ),
    ).toEqual({ ok: false, error: 'invalid_effective_on' });

    expect(
      planPersonnelLifecycleChange(
        request({
          reason: 'no',
          idempotencyKey: 'synthetic-short-reason-001',
        }),
      ),
    ).toEqual({ ok: false, error: 'invalid_reason' });
  });
});

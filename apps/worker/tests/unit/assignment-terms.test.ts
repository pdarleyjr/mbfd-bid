import { describe, expect, it } from 'vitest';
import { evaluateAssignmentTerms } from '../../src/lib/assignment-terms.js';
import type { TenureEvidence } from '../../src/lib/tenure-evidence.js';

const term = {
  id: 'synthetic-marine-term',
  positionIds: ['P1'],
  requiredServiceMonths: 24,
  reopenAfterConsecutiveCycles: 2,
  closedForThisBid: false,
  sourceRef: 'synthetic:approved-term-policy',
};
const record: TenureEvidence = {
  id: 'synthetic-term-fact',
  staffingPositionId: 'S1',
  revision: 1,
  effectiveOn: '2026-09-01',
  status: 'UNPROTECTED',
  memberId: null,
  protectedFrom: null,
  protectedThrough: null,
  sourceRef: 'synthetic:reviewed-holder-facts',
  reason: 'Synthetic holder evidence',
  actorSubject: '99',
  termMemberId: 101,
  accumulatedServiceMonths: 24,
  consecutiveBidCycles: 1,
};
function input() {
  return {
    asOf: '2026-09-01',
    terms: [term],
    records: [record],
    bindings: [{ positionId: 'P1', staffingPositionId: 'S1', reviewStatus: 'approved' }],
    assignments: [{ staffingPositionId: 'S1', memberId: 101 }],
    nonBiddablePositionIds: [] as string[],
  };
}

describe('source-backed assignment service and cycle evaluation', () => {
  it('permits departure after prior service while preserving the current appointment protection through its final day', () => {
    const base = {
      ...input(),
      terms: [{ ...term, reopenAfterConsecutiveCycles: 3 }],
      records: [
        {
          ...record,
          status: 'PROTECTED' as const,
          memberId: 101,
          accumulatedServiceMonths: 36,
          consecutiveBidCycles: 2,
          protectedFrom: '2026-01-01',
          protectedThrough: '2026-12-31',
        },
      ],
      nonBiddablePositionIds: ['P1'],
    };
    expect(evaluateAssignmentTerms(base)).toMatchObject([
      {
        status: 'EVALUATED',
        code: 'term_in_progress',
        memberMayLeave: true,
        offerAnnually: false,
        protected: true,
      },
    ]);
    expect(evaluateAssignmentTerms({ ...base, asOf: '2026-12-31' })).toMatchObject([
      { protected: true, memberMayLeave: true },
    ]);
    expect(evaluateAssignmentTerms({ ...base, asOf: '2027-01-01' })).toMatchObject([
      {
        status: 'EVALUATED',
        code: 'term_service_complete',
        protected: false,
        memberMayLeave: true,
        offerAnnually: false,
      },
    ]);
    expect(evaluateAssignmentTerms({ ...base, nonBiddablePositionIds: [] })).toMatchObject([
      {
        status: 'BLOCKED',
        code: 'protected_term_cannot_be_biddable',
        memberMayLeave: true,
        protected: true,
      },
    ]);
    expect(evaluateAssignmentTerms({ ...base, terms: [term] })).toMatchObject([
      { status: 'BLOCKED', code: 'term_service_cycle_conflict' },
    ]);
  });

  it('distinguishes completed accumulated service from consecutive annual reopening cycles', () => {
    const before = input();
    expect(evaluateAssignmentTerms(before)).toMatchObject([
      {
        status: 'EVALUATED',
        code: 'term_service_complete',
        memberMayLeave: true,
        offerAnnually: false,
        protected: false,
        requiredServiceMonths: 24,
        reopenAfterConsecutiveCycles: 2,
        sourceRef: term.sourceRef,
      },
    ]);
    expect(
      evaluateAssignmentTerms({ ...input(), records: [{ ...record, consecutiveBidCycles: 2 }] }),
    ).toMatchObject([
      {
        status: 'EVALUATED',
        code: 'term_annually_open',
        memberMayLeave: true,
        offerAnnually: true,
      },
    ]);
    expect(before).toEqual(input());
  });

  it('protects service below the exact month threshold and requires the position closed', () => {
    const base = { ...input(), records: [{ ...record, accumulatedServiceMonths: 23 }] };
    expect(evaluateAssignmentTerms(base)).toMatchObject([
      { status: 'BLOCKED', code: 'protected_term_cannot_be_biddable' },
    ]);
    expect(evaluateAssignmentTerms({ ...base, nonBiddablePositionIds: ['P1'] })).toMatchObject([
      {
        status: 'EVALUATED',
        code: 'term_in_progress',
        memberMayLeave: false,
        offerAnnually: false,
        protected: true,
      },
    ]);
  });

  it('rejects completed cycle claims that conflict with unfinished service and closed seats after reopening', () => {
    expect(
      evaluateAssignmentTerms({
        ...input(),
        records: [{ ...record, accumulatedServiceMonths: 23, consecutiveBidCycles: 2 }],
      }),
    ).toMatchObject([
      {
        status: 'BLOCKED',
        code: 'term_service_cycle_conflict',
        memberMayLeave: null,
        offerAnnually: null,
      },
    ]);
    expect(
      evaluateAssignmentTerms({
        ...input(),
        records: [{ ...record, consecutiveBidCycles: 2 }],
        nonBiddablePositionIds: ['P1'],
      }),
    ).toMatchObject([{ status: 'BLOCKED', code: 'completed_cycles_require_annual_reopening' }]);
  });

  it.each([
    { termMemberId: null },
    { termMemberId: 202 },
    { accumulatedServiceMonths: null },
    { consecutiveBidCycles: null },
  ])(
    'fails closed on incomplete or wrong holder facts %j without inferring from dates',
    (missing) => {
      expect(
        evaluateAssignmentTerms({
          ...input(),
          records: [
            {
              ...record,
              status: 'PROTECTED',
              memberId: 101,
              protectedFrom: '2000-01-01',
              protectedThrough: '2001-12-31',
              ...missing,
            },
          ],
        }),
      ).toMatchObject([
        {
          status: 'BLOCKED',
          code: 'term_holder_service_evidence_required',
          memberMayLeave: null,
          offerAnnually: null,
          protected: null,
        },
      ]);
    },
  );

  it('requires reviewed binding, unambiguous holder and known evidence', () => {
    expect(evaluateAssignmentTerms({ ...input(), bindings: [] })).toMatchObject([
      { code: 'term_binding_required' },
    ]);
    expect(
      evaluateAssignmentTerms({
        ...input(),
        bindings: [{ positionId: 'P1', staffingPositionId: 'S1', reviewStatus: 'pending' }],
      }),
    ).toMatchObject([{ code: 'term_binding_required' }]);
    expect(
      evaluateAssignmentTerms({
        ...input(),
        assignments: [...input().assignments, { staffingPositionId: 'S1', memberId: 202 }],
      }),
    ).toMatchObject([{ code: 'term_holder_ambiguous' }]);
    expect(evaluateAssignmentTerms({ ...input(), records: [] })).toMatchObject([
      { code: 'term_evidence_required' },
    ]);
    expect(
      evaluateAssignmentTerms({ ...input(), records: [{ ...record, status: 'UNKNOWN' }] }),
    ).toMatchObject([{ code: 'term_evidence_required' }]);
  });

  it('allows an explicit annual closure without inventing holder dates or service facts', () => {
    const base = {
      ...input(),
      terms: [{ ...term, closedForThisBid: true }],
      records: [],
      nonBiddablePositionIds: ['P1'],
    };
    expect(evaluateAssignmentTerms(base)).toMatchObject([
      {
        status: 'EVALUATED',
        code: 'term_closed_by_annual_policy',
        memberMayLeave: null,
        offerAnnually: false,
        protected: null,
        sourceRef: term.sourceRef,
      },
    ]);
    expect(evaluateAssignmentTerms({ ...base, nonBiddablePositionIds: [] })).toMatchObject([
      { status: 'BLOCKED', code: 'term_annual_closure_required' },
    ]);
    expect(evaluateAssignmentTerms({ ...base, bindings: [] })).toMatchObject([
      { status: 'BLOCKED', code: 'term_binding_required' },
    ]);
    expect(
      evaluateAssignmentTerms({
        ...base,
        assignments: [...base.assignments, { staffingPositionId: 'S1', memberId: 202 }],
      }),
    ).toMatchObject([{ status: 'BLOCKED', code: 'term_holder_ambiguous' }]);
  });

  it('evaluates explicit vacancies only with known evidence and leaves snapshots without terms unchanged', () => {
    expect(evaluateAssignmentTerms({ ...input(), assignments: [], records: [] })).toMatchObject([
      { status: 'BLOCKED', code: 'term_evidence_required' },
    ]);
    expect(
      evaluateAssignmentTerms({
        ...input(),
        assignments: [],
        records: [
          {
            ...record,
            termMemberId: null,
            accumulatedServiceMonths: null,
            consecutiveBidCycles: null,
          },
        ],
      }),
    ).toMatchObject([
      { status: 'EVALUATED', code: 'term_vacant', offerAnnually: true, memberMayLeave: null },
    ]);
    expect(evaluateAssignmentTerms({ ...input(), terms: [] })).toEqual([]);
  });
});

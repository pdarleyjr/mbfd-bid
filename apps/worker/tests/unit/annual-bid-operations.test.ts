import { describe, expect, it } from 'vitest';
import {
  ANNUAL_2026_STAGE_ORDER,
  declareUnreachable,
  evaluateNextPreference,
  evaluateSpecialtyEligibility,
  initializeAnnualOperations,
  recordContactAttempt,
  returnAtCurrentSequence,
  upsertPreferenceSheet,
  validateAnnualOperationsReadiness,
  validateSpecialtyADayMaximum,
} from '../../src/lib/annual-bid-operations.js';

const operations = {
  v: 1 as const,
  stageOrder: [...ANNUAL_2026_STAGE_ORDER],
  requiredTopologyPositionIds: ['MARINE_A_CAPTAIN'],
  contact: {
    minimumAttempts: 3,
    timingMode: 'OPERATOR_DISCRETION' as const,
    durationSeconds: null,
  },
  aDay: {
    combatGroups: ['G1', 'G2', 'G3', 'G4'] as const,
    min: 18,
    max: 19,
    captainDcMax: 2,
    specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
  },
};

describe('annual bid operations', () => {
  it('requires the exact configurable 2026 stage ordering and complete topology before real use', () => {
    expect(
      validateAnnualOperationsReadiness({
        operations,
        bidYear: 2026,
        isMock: false,
        configuredStageIds: [...ANNUAL_2026_STAGE_ORDER],
        missingTopologyIds: [],
      }),
    ).toEqual({ ok: true });
    expect(
      validateAnnualOperationsReadiness({
        operations,
        bidYear: 2026,
        isMock: false,
        configuredStageIds: [...ANNUAL_2026_STAGE_ORDER],
        missingTopologyIds: ['MARINE_A_CAPTAIN'],
      }),
    ).toMatchObject({ ok: false, code: 'ANNUAL_TOPOLOGY_INCOMPLETE' });
  });

  it('keeps frozen preference sheets as decision support and selects the next valid combination', () => {
    const state = initializeAnnualOperations({
      preferenceSheets: [
        {
          id: 'sheet-1',
          memberId: 7,
          source: 'MEMBER_SUBMISSION',
          submittedAtMs: 1,
          status: 'FROZEN',
          positionIds: ['filled', 'open'],
          aDays: ['G1', 'G2'],
        },
      ],
    });
    expect(
      evaluateNextPreference({
        state,
        memberId: 7,
        isPositionAvailable: (id) => id === 'open',
        validateADay: (_positionId, aDay) =>
          aDay === 'G2' ? { ok: true } : { ok: false, code: 'GROUP_FULL' },
      }),
    ).toEqual({ ok: true, preferenceSheetId: 'sheet-1', positionId: 'open', aDay: 'G2' });
  });

  it('requires three recorded contact attempts, preserves an unresolved member, and returns them at current sequence', () => {
    let state = initializeAnnualOperations({ preferenceSheets: [] });
    for (const method of ['PHONE', 'TEXT', 'PHONE'] as const) {
      const result = recordContactAttempt(state, {
        memberId: 9,
        method,
        actorMemberId: 99,
        atMs: state.contactAttempts.length + 1,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      state = result.state;
    }
    const unreachable = declareUnreachable(state, operations, { memberId: 9, actorMemberId: 99 });
    expect(unreachable).toMatchObject({ ok: true });
    if (!unreachable.ok) throw new Error(unreachable.code);
    expect(unreachable.state.unresolvedMemberIds).toEqual([9]);
    const returned = returnAtCurrentSequence(unreachable.state, { memberId: 9, sequence: 42 });
    expect(returned).toMatchObject({ ok: true });
    if (!returned.ok) throw new Error(returned.code);
    expect(returned.state.returnedAtCurrentSequence).toEqual([{ memberId: 9, sequence: 42 }]);
    expect(returned.state.returningMemberId).toBe(9);
  });

  it('fails closed when contact timer policy is absent rather than inventing a 15-minute rule', () => {
    const state = initializeAnnualOperations({ preferenceSheets: [] });
    expect(declareUnreachable(state, undefined, { memberId: 9, actorMemberId: 99 })).toMatchObject({
      ok: false,
      code: 'CONTACT_POLICY_MISSING',
    });
  });

  it('keeps dedicated specialty topology distinct from membership-only SWAT and enforces known A-Day maxima', () => {
    expect(
      evaluateSpecialtyEligibility({
        rule: {
          code: 'AIR_TECH_810',
          kind: 'DEDICATED_POSITION',
          positionIds: ['810-A'],
          requiredCredentials: ['DE', 'Scott Air Pack Tech', 'Bottle Fill'],
        },
        positionId: '810-A',
        credentialNames: ['DE', 'Scott Air Pack Tech'],
      }),
    ).toEqual({ ok: false, code: 'SPECIALTY_CREDENTIAL_REQUIRED' });
    expect(
      evaluateSpecialtyEligibility({
        rule: {
          code: 'SWAT',
          kind: 'MEMBERSHIP_DISTRIBUTION',
          positionIds: [],
          requiredCredentials: ['SWAT'],
        },
        positionId: 'invented-swat-seat',
        credentialNames: ['SWAT'],
      }),
    ).toEqual({ ok: false, code: 'MEMBERSHIP_SPECIALTY_MUST_NOT_INVENT_POSITION' });
    expect(
      validateSpecialtyADayMaximum({ specialty: 'SWAT', existingCount: 1, policy: operations }),
    ).toEqual({
      ok: false,
      code: 'SPECIALTY_A_DAY_MAX_REACHED',
    });
  });

  it('rejects changes after the preference sheet has been frozen', () => {
    const state = initializeAnnualOperations({
      preferenceSheets: [
        {
          id: 'frozen-sheet',
          memberId: 7,
          source: 'MEMBER_SUBMISSION',
          submittedAtMs: 1,
          status: 'FROZEN',
          positionIds: ['open'],
          aDays: ['G1'],
        },
      ],
    });
    expect(
      upsertPreferenceSheet(state, {
        id: 'replacement',
        memberId: 7,
        source: 'MEMBER_SUBMISSION',
        submittedAtMs: 2,
        status: 'SUBMITTED',
        positionIds: ['different'],
        aDays: ['G2'],
      }),
    ).toEqual({ ok: false, code: 'PREFERENCE_SHEET_FROZEN' });
  });
});

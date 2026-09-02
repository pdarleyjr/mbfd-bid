import { describe, expect, it } from 'vitest';

import {
  evaluateFinalization,
  evaluateLeadTime,
  reconcileFutureRoster,
} from '../../src/lib/post-bid-transition.js';
import type { FutureRosterObservation } from '../../src/lib/post-bid-transition.js';

describe('post-Bid transition policy', () => {
  it('fails finalization closed until canonical annual completion and immutable references exist', () => {
    expect(
      evaluateFinalization({
        annualCompletionAtMs: null,
        expectedPositionIds: ['A101'],
        awards: [{ memberId: 1, positionId: 'A101' }],
        unresolvedMemberIds: [],
        topologyReference: '2026.1',
        ruleBookVersion: '2026.1',
      }),
    ).toEqual({ ok: false, blockingCodes: ['ANNUAL_COMPLETION_MISSING'] });

    expect(
      evaluateFinalization({
        annualCompletionAtMs: 1,
        expectedPositionIds: ['A101'],
        awards: [{ memberId: 1, positionId: 'A101' }],
        unresolvedMemberIds: [],
        topologyReference: null,
        ruleBookVersion: '2026.1',
      }),
    ).toEqual({ ok: false, blockingCodes: ['FROZEN_TOPOLOGY_REFERENCE_MISSING'] });
  });

  it('keeps the two-week statement configurable: hard-minimum blocks, target only warns', () => {
    expect(
      evaluateLeadTime({ completionOn: '2030-01-01', effectiveOn: '2030-01-10', policy: { mode: 'HARD_MINIMUM', days: 14 } }),
    ).toEqual({ ok: false, code: 'EFFECTIVE_DATE_HARD_MINIMUM_NOT_MET' });
    expect(
      evaluateLeadTime({ completionOn: '2030-01-01', effectiveOn: '2030-01-10', policy: { mode: 'TARGET', days: 14 } }),
    ).toEqual({ ok: true, warning: 'EFFECTIVE_DATE_TARGET_NOT_MET' });
  });

  it('classifies post-TeleStaff observations without changing canonical expected results', () => {
    const expected: FutureRosterObservation[] = [{ memberId: 1, shift: 'A', station: '1', unit: 'Engine', position: 'FF', aDay: 'G1' }];
    expect(reconcileFutureRoster(expected, expected)).toEqual([{ memberId: 1, classification: 'EXACT_MATCH' }]);
    expect(
      reconcileFutureRoster(expected, [
        { memberId: 1, shift: 'B', station: '1', unit: 'Engine', position: 'FF', aDay: 'G1' },
      ]),
    ).toEqual([{ memberId: 1, classification: 'SHIFT_MISMATCH' }]);
  });
});

import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { requiresCanonicalAnnualExecution } from '../src/lib/canonical-annual-execution.js';

// A capability-presence check only; full schema and frozen-integrity checks
// execute in the route before this guard, covered by pinned integration tests.
function snapshot(operations: Record<string, unknown> = {}, member = {}) {
  return {
    v: 3,
    settings: { v: 3, livePolicy: { annualOperations: { aDay: {}, ...operations } } },
    members: [member],
  } as unknown as BidSessionPolicySnapshot;
}
describe('legacy rehearsal canonical capability boundary', () => {
  it('preserves historical optional absence', () => {
    expect(requiresCanonicalAnnualExecution(snapshot())).toBe(false);
    expect(requiresCanonicalAnnualExecution({ v: 2 } as BidSessionPolicySnapshot)).toBe(false);
  });
  it.each(['opportunityPools', 'fallbackPolicies', 'assignmentTerms', 'membershipDistributions'])(
    'blocks explicit %s, including an empty configured array',
    (field) => {
      expect(requiresCanonicalAnnualExecution(snapshot({ [field]: [] }))).toBe(true);
    },
  );
  it.each(['SIMULTANEOUS', 'AFTER_POSITION_SELECTION'] as const)(
    'blocks every configured A-Day timing model: %s',
    (timing) => {
      expect(requiresCanonicalAnnualExecution(snapshot({ aDay: { execution: { timing } } }))).toBe(
        true,
      );
    },
  );
  it('blocks frozen member term participation', () => {
    expect(requiresCanonicalAnnualExecution(snapshot({}, { termParticipation: {} }))).toBe(true);
  });
});

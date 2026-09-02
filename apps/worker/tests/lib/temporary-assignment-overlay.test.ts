import { describe, expect, it } from 'vitest';
import { previewTemporaryOverlay } from '../../src/lib/temporary-assignment-overlay.js';

const base = {
  memberId: 7,
  underlyingAssignmentId: 'bid-a',
  underlyingPositionId: 'engine-a',
  effectiveOn: '2026-10-01',
  temporaryPositionId: 'staff-a',
  plannedEndOn: null,
};

describe('previewTemporaryOverlay', () => {
  it.each(['SPECIAL_ASSIGNMENT', 'LIGHT_DUTY'] as const)(
    '%s preserves Bid and A-Day assignment with nullable end',
    (kind) => {
      expect(previewTemporaryOverlay({ ...base, kind })).toMatchObject({
        ok: true,
        underlyingBidAssignmentPreserved: true,
        aDayPreserved: true,
        memberRemainsBidEligible: true,
        dailyVacancy: { positionId: 'engine-a', bidVacancy: false },
        automaticReturn: 'ON_END_OR_CLEARANCE',
        plannedEndOn: null,
      });
    },
  );
  it('keeps unresolved temporary categories policy-pending', () => {
    expect(previewTemporaryOverlay({ ...base, kind: 'DETAIL' })).toEqual({
      ok: false,
      error: 'TEMPORARY_ASSIGNMENT_POLICY_PENDING',
    });
  });
});

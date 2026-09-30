import { expect, it } from 'vitest';
import { unresolvedQualificationHolds } from '../../src/lib/qualification-review-hold.js';

const hold = {
  memberId: 1,
  credentialId: 10,
  credentialName: 'Synthetic PSD',
  reviewedAt: 200,
  observedOn: '2026-09-29',
};
it('withholds a reviewed assertion despite legacy, unrelated or future-only evidence', () => {
  expect(
    unresolvedQualificationHolds(
      [hold],
      [
        { memberId: 1, credentialId: 10, createdAt: 100, effectiveOn: '2026-01-01' },
        { memberId: 2, credentialId: 10, createdAt: 300, effectiveOn: '2026-09-29' },
        { memberId: 1, credentialId: 11, createdAt: 300, effectiveOn: '2026-09-29' },
        { memberId: 1, credentialId: 10, createdAt: 300, effectiveOn: '2029-01-01' },
      ],
      '2026-09-30',
    ),
  ).toEqual([hold]);
});
it('accepts later approved evidence only for the exact member and qualification at its effective date', () => {
  const renewal = { memberId: 1, credentialId: 10, createdAt: 300, effectiveOn: '2026-09-30' };
  expect(unresolvedQualificationHolds([hold], [renewal], '2026-09-29')).toEqual([hold]);
  expect(unresolvedQualificationHolds([hold], [renewal], '2026-09-30')).toEqual([]);
  expect(unresolvedQualificationHolds([hold], [], '2026-09-28')).toEqual([]);
});

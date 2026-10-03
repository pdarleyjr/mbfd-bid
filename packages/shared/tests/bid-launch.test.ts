import { describe, expect, it } from 'vitest';
import {
  BidLaunchAcknowledgementSchema,
  BidLaunchReviewSchema,
  BidStartSchema,
} from '../src/index.js';

describe('operator launch acknowledgement contract', () => {
  it('accepts only the review digest and never a client authorization or qualification approval', () => {
    const acknowledgement = { advisorySha256: 'a'.repeat(64) };
    expect(BidLaunchAcknowledgementSchema.parse(acknowledgement)).toEqual(acknowledgement);
    for (const extra of [
      { authorized: true },
      { resolveSourceDecisions: true },
      { approveCredentials: true },
    ])
      expect(
        BidLaunchAcknowledgementSchema.safeParse({ ...acknowledgement, ...extra }).success,
      ).toBe(false);
    expect(BidStartSchema.parse({})).toEqual({});
    expect(BidStartSchema.safeParse({ override: true }).success).toBe(false);
  });

  it('preserves server advisories and rejects malformed counts or digests', () => {
    const review = {
      advisorySha256: 'b'.repeat(64),
      requiresAcknowledgement: true,
      advisories: [
        {
          id: 'qualification_holds',
          code: 'credential_import_dispute_requires_review',
          detail: 'Held qualifications remain unavailable.',
          affectedCount: 2,
        },
      ],
    };
    expect(BidLaunchReviewSchema.parse(review)).toEqual(review);
    expect(
      BidLaunchReviewSchema.safeParse({ ...review, requiresAcknowledgement: false }).success,
    ).toBe(false);
    expect(BidLaunchReviewSchema.safeParse({ ...review, advisories: [] }).success).toBe(false);
    expect(
      BidLaunchReviewSchema.safeParse({ ...review, advisorySha256: 'not-a-digest' }).success,
    ).toBe(false);
    expect(
      BidLaunchReviewSchema.safeParse({
        ...review,
        advisories: [{ ...review.advisories[0], affectedCount: 0 }],
      }).success,
    ).toBe(false);
  });
});

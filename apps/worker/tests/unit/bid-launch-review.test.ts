import { describe, expect, it } from 'vitest';
import {
  buildBidLaunchReview,
  checkBidLaunchAcknowledgement,
  credentialHoldLaunchAdvisory,
  sourceQuestionLaunchAdvisory,
} from '../../src/lib/bid-launch-review.js';

describe('exact-context operator launch review', () => {
  const context = {
    mode: 'live' as const,
    versionId: 'saved-version',
    versionSha256: 'a'.repeat(64),
    contextSha256: 'b'.repeat(64),
  };
  const advisories = [...sourceQuestionLaunchAdvisory(27), ...credentialHoldLaunchAdvisory(2)];
  it('reports 27 unresolved source questions and 2 held credentials without acknowledging either', () => {
    const review = buildBidLaunchReview(context, advisories);
    expect(review.requiresAcknowledgement).toBe(true);
    expect(review.advisories.map((advisory) => advisory.affectedCount).sort()).toEqual([2, 27]);
    expect(checkBidLaunchAcknowledgement(review, undefined)).toMatchObject({
      ok: false,
      error: 'launch_acknowledgement_required',
    });
    expect(
      checkBidLaunchAcknowledgement(review, { advisorySha256: review.advisorySha256 }),
    ).toEqual({ ok: true, acknowledged: true });
  });
  it('binds the review to mode, exact version, context and advisory set', () => {
    const review = buildBidLaunchReview(context, advisories);
    expect(buildBidLaunchReview(context, [...advisories].reverse())).toEqual(review);
    for (const changed of [
      { ...context, mode: 'mock' as const },
      { ...context, versionId: 'successor' },
      { ...context, contextSha256: 'c'.repeat(64) },
    ])
      expect(buildBidLaunchReview(changed, advisories).advisorySha256).not.toBe(
        review.advisorySha256,
      );
    expect(buildBidLaunchReview(context, sourceQuestionLaunchAdvisory(26)).advisorySha256).not.toBe(
      review.advisorySha256,
    );
    expect(
      checkBidLaunchAcknowledgement(review, { advisorySha256: 'd'.repeat(64) }, true),
    ).toMatchObject({ ok: false, error: 'launch_review_changed' });
    expect(checkBidLaunchAcknowledgement(review, undefined, true)).toEqual({
      ok: true,
      acknowledged: true,
    });
  });
  it('deduplicates identical advisories but preserves distinct simultaneous details', () => {
    const first = advisories[0];
    if (!first) throw new Error('Expected advisory fixture');
    const changed = { ...first, detail: 'A distinct held assertion requires review.' };
    const review = buildBidLaunchReview(context, [...advisories, first, changed]);
    expect(review.advisories).toHaveLength(3);
    expect(review.advisories.map((entry) => entry.detail)).toContain(changed.detail);
    expect(buildBidLaunchReview(context, [changed, ...advisories].reverse())).toEqual(review);
  });
});

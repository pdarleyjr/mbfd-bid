import { describe, expect, it } from 'vitest';
import {
  FrozenBidEligibilityMemberSchema,
  FrozenScoreReferenceEvidenceSchema,
  FrozenScoreReferenceSourceSchema,
} from '../../src/index.js';
import { BidImpactComparisonStepSchema } from '../../src/schemas/bid-impact.js';

const reference = {
  v: 1,
  listId: 'SYNTHETIC_FINAL',
  positionIds: ['P1'],
  points: 12,
  soPoints: 6,
  moPoints: 0,
  sourceName: 'Synthetic ranking.pdf',
  sourceSha256: 'a'.repeat(64),
  sourceLocation: { page: 1, textLine: 10 },
  literalTotal: 12,
  printedBidOrder: null,
  sourcePriority: 1,
};
const member = {
  memberId: 1,
  pool: 'OFC',
  rscSeniority: 1,
  rankSeniority: 1,
  exclusionReason: null,
  authoritativeAssignmentId: null,
  rank: 'LT',
  isProbationary: false,
  credentialNames: [],
};

describe('source score evidence schemas', () => {
  it('preserves absent evidence in historical members without adding defaults', () => {
    expect(JSON.stringify(FrozenBidEligibilityMemberSchema.parse(member))).toBe(
      JSON.stringify(member),
    );
  });
  it('accepts literal totals and optional printed ordinals without deriving credentials', () => {
    expect(FrozenScoreReferenceEvidenceSchema.parse(reference)).toEqual(reference);
    const parsed = FrozenBidEligibilityMemberSchema.parse({
      ...member,
      scoreReferenceEvidence: [reference],
    });
    expect(parsed.credentialNames).toEqual([]);
  });
  it('rejects invalid points, provenance, scopes, and executable qualification fields', () => {
    for (const patch of [
      { points: -1 },
      { points: Number.NaN },
      { points: Number.POSITIVE_INFINITY },
      { sourcePriority: 0 },
      { sourceLocation: { page: 0, textLine: 1 } },
      { sourceSha256: 'bad-hash' },
      { positionIds: ['P1', 'P1'] },
      { grantsCredentials: ['Synthetic Qualification'] },
    ])
      expect(FrozenScoreReferenceEvidenceSchema.safeParse({ ...reference, ...patch }).success).toBe(
        false,
      );
  });
  it('rejects competing member references for an exact position while allowing independent scopes', () => {
    expect(
      FrozenBidEligibilityMemberSchema.safeParse({
        ...member,
        scoreReferenceEvidence: [reference, { ...reference, listId: 'OTHER' }],
      }).success,
    ).toBe(false);
    expect(
      FrozenBidEligibilityMemberSchema.safeParse({
        ...member,
        scoreReferenceEvidence: [reference, { ...reference, listId: 'OTHER', positionIds: ['P2'] }],
      }).success,
    ).toBe(true);
  });
  it('accepts only exact source archive and immutable receipt identity', () => {
    const source = {
      v: 1,
      archiveSha256: 'a'.repeat(64),
      receiptSha256: 'b'.repeat(64),
      sourceVersionId: 'synthetic-version',
    };
    expect(FrozenScoreReferenceSourceSchema.parse(source)).toEqual(source);
    expect(
      FrozenScoreReferenceSourceSchema.safeParse({ ...source, receiptSha256: 'bad' }).success,
    ).toBe(false);
    expect(
      FrozenScoreReferenceSourceSchema.safeParse({ ...source, unexpected: true }).success,
    ).toBe(false);
  });
  it('preserves source priority provenance in API comparison traces', () => {
    const step = {
      key: 'source_priority',
      listId: 'SYNTHETIC_FINAL',
      sourceSha256: 'a'.repeat(64),
      left: 1,
      right: 2,
      direction: 'LOWER_FIRST',
      result: -1,
    };
    expect(BidImpactComparisonStepSchema.parse(step)).toEqual(step);
  });
});

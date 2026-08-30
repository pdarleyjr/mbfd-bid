import { describe, expect, it } from 'vitest';
import {
  BID_EVENT_VERSION,
  BidEventEnvelopeSchema,
  ClientHelloMessageSchema,
  PickMadeEventSchema,
  PickRejectedEventSchema,
  StateSnapshotEventSchema,
  SubmitPickMessageSchema,
  SyntheticSpecialtyStateSignalSchema,
} from '../src/index.js';

describe('bid event schemas (Plan 04 Task 2)', () => {
  it('accepts a reconnect hello without a bearer credential', () => {
    expect(ClientHelloMessageSchema.safeParse({ type: 'hello', lastSeq: 7 }).success).toBe(true);
  });

  it('BID_EVENT_VERSION is a positive integer', () => {
    expect(BID_EVENT_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(BID_EVENT_VERSION)).toBe(true);
  });

  it('envelope requires v, seq, type, and a typed payload', () => {
    const ok = BidEventEnvelopeSchema.safeParse({
      v: BID_EVENT_VERSION,
      seq: 42,
      type: 'pick_made',
      ts: Date.now(),
      payload: {
        bidId: '01HXYZ',
        bidSessionId: '01HSESS',
        ordinal: 5,
        memberId: 17,
        positionId: 'A101',
        aDay: null,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        nextBidderId: 22,
        turnStartedAtMs: Date.now(),
      },
    });
    expect(ok.success).toBe(true);
  });

  it('rejects envelope with wrong version', () => {
    const r = BidEventEnvelopeSchema.safeParse({
      v: BID_EVENT_VERSION + 99,
      seq: 1,
      type: 'pick_made',
      ts: 0,
      payload: {},
    });
    expect(r.success).toBe(false);
  });

  it('SubmitPickMessageSchema requires idempotencyKey UUID', () => {
    expect(
      SubmitPickMessageSchema.safeParse({
        type: 'submit_pick',
        positionId: 'A101',
        aDay: null,
        idempotencyKey: 'not-a-uuid',
      }).success,
    ).toBe(false);

    expect(
      SubmitPickMessageSchema.safeParse({
        type: 'submit_pick',
        positionId: 'A101',
        aDay: null,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);
  });

  it('PickRejectedEventSchema carries machine-stable reason code', () => {
    const r = PickRejectedEventSchema.safeParse({
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      code: 'NOT_YOUR_TURN',
      message: 'Active bidder is member 7; your member id is 17',
    });
    expect(r.success).toBe(true);
  });

  it('StateSnapshotEventSchema includes seq and full fills map shape', () => {
    const r = StateSnapshotEventSchema.safeParse({
      bidSessionId: '01HSESS',
      seq: 100,
      currentPhase: 'position_bid',
      currentBidderId: 7,
      turnStartedAtMs: Date.now(),
      turnTimerSeconds: 180,
      frozenAt: null,
      fills: [{ positionId: 'A101', memberId: 17, ordinal: 5 }],
      bidOrder: [{ ordinal: 1, memberId: 1, pool: 'OFC' }],
    });
    expect(r.success).toBe(true);
  });

  it('keeps the synthetic specialty signal out of the normal Bid event sequence', () => {
    const signal = {
      v: 1,
      type: 'synthetic_specialty_state_changed',
      mode: 'synthetic_test_only',
      does_not_commit_bid: true,
      bidSessionId: '01HSESS',
      revision: 4,
      controlState: {
        rehearsalRevision: 9,
        normalTurn: {
          turnId: 'mock-normal:01HSESS:9:1:0:17',
          bidderId: 17,
          ordinal: 1,
          queueCursor: 0,
          mockControlRevision: 9,
        },
        normalBidderSuspended: true,
        specialty: {
          active: true,
          requestId: 'synthetic-request-1',
          positionId: 'A101',
          phase: 'resolving_higher_priority_candidates',
          originalTurn: {
            turnId: 'mock-normal:01HSESS:9:1:0:17',
            bidderId: 17,
            ordinal: 1,
            queueCursor: 0,
            mockControlRevision: 9,
          },
          candidateQueue: [{ memberId: 11, priorityRank: 1 }],
          candidateCursor: 0,
          resolvedCandidateCount: 0,
          resolution: null,
          allowedNextAction: 'resolve_candidate',
        },
      },
    };
    expect(SyntheticSpecialtyStateSignalSchema.safeParse(signal).success).toBe(true);
    expect(BidEventEnvelopeSchema.safeParse(signal).success).toBe(false);
    expect(
      SyntheticSpecialtyStateSignalSchema.safeParse({ ...signal, controlState: undefined }).success,
    ).toBe(false);
  });

  it('PickMadeEventSchema validates discriminant by exact match', () => {
    expect(PickMadeEventSchema.safeParse({}).success).toBe(false);
  });
});

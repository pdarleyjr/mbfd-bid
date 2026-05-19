import { describe, expect, it } from 'vitest';
import { createBidStore } from '../../app/bid/_hooks/useBidStore';

describe('useBidStore (Plan 04 Task 12)', () => {
  it('applies pick_made events and bumps seq', () => {
    const s = createBidStore({ bidSessionId: 'X', initialSeq: 0, meMemberId: 17 });
    s.getState().applyEvent({
      v: 1,
      seq: 1,
      ts: 0,
      type: 'pick_made',
      payload: {
        bidId: 'B',
        bidSessionId: 'X',
        ordinal: 1,
        memberId: 17,
        positionId: 'A101',
        rDay: null,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        nextBidderId: 18,
        turnStartedAtMs: 1,
      },
    });
    expect(s.getState().lastSeq).toBe(1);
    expect(s.getState().fills.A101?.memberId).toBe(17);
    expect(s.getState().currentBidderId).toBe(18);
  });

  it('ignores events with seq <= lastSeq (idempotency on resync)', () => {
    const s = createBidStore({ bidSessionId: 'X', initialSeq: 5, meMemberId: 17 });
    s.getState().applyEvent({
      v: 1,
      seq: 3,
      ts: 0,
      type: 'pick_made',
      payload: {
        bidId: 'B',
        bidSessionId: 'X',
        ordinal: 1,
        memberId: 99,
        positionId: 'A101',
        rDay: null,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        nextBidderId: 18,
        turnStartedAtMs: 1,
      },
    });
    expect(s.getState().fills.A101).toBeUndefined();
  });

  it('markPendingMine + reconcileOnPickMade with matching idem key clears pendingMine', () => {
    const s = createBidStore({ bidSessionId: 'X', initialSeq: 0, meMemberId: 17 });
    s.getState().markPendingMine('A101', 'k');
    expect(s.getState().pendingMine.A101).toBe('k');
    s.getState().applyEvent({
      v: 1,
      seq: 1,
      ts: 0,
      type: 'pick_made',
      payload: {
        bidId: 'B',
        bidSessionId: 'X',
        ordinal: 1,
        memberId: 17,
        positionId: 'A101',
        rDay: null,
        idempotencyKey: 'k-uuid',
        nextBidderId: 18,
        turnStartedAtMs: 1,
      },
    });
    // pending should clear once the canonical fill lands
    expect(s.getState().pendingMine.A101).toBeUndefined();
  });

  it('pick_rejected rolls back pendingMine and sets lastError', () => {
    const s = createBidStore({ bidSessionId: 'X', initialSeq: 0, meMemberId: 17 });
    s.getState().markPendingMine('A101', 'kkk');
    s.getState().applyEvent({
      v: 1,
      seq: 1,
      ts: 0,
      type: 'pick_rejected',
      payload: { idempotencyKey: 'kkk', code: 'POSITION_FILLED', message: 'taken' },
    });
    expect(s.getState().pendingMine.A101).toBeUndefined();
    expect(s.getState().lastError?.code).toBe('POSITION_FILLED');
  });
});

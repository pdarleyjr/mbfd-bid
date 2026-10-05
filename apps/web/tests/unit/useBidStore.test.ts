import { describe, expect, it } from 'vitest';
import { type Fill, createBidStore } from '../../app/bid/_hooks/useBidStore';

describe('useBidStore (Plan 04 Task 12)', () => {
  it('preserves canonical forced and A-Day provenance across a sparse legacy snapshot', () => {
    const store = createBidStore({ bidSessionId: 'X', initialSeq: 5, meMemberId: 17 });
    const retained: Fill = {
      memberId: 17,
      ordinal: 1,
      bidId: 'saved-canonical-award',
      aDay: 'G3',
      forced: { commandId: 'saved-force', actorMemberId: 99, reason: '', atMs: 1 },
      aDayDeferral: {
        commandId: 'saved-deferral',
        actorMemberId: 99,
        reason: '',
        positionId: 'A101',
      },
      aDayOverride: {
        commandId: 'saved-aday',
        actorMemberId: 99,
        reason: '',
        positionId: 'A101',
        aDay: 'G3',
        warningCodes: [],
      },
    };
    store.setState({ fills: { A101: retained } });
    store.getState().applyEvent({
      v: 1,
      type: 'state_snapshot',
      seq: 5,
      ts: 0,
      payload: {
        fills: [{ positionId: 'A101', memberId: 17, ordinal: 1 }],
        currentBidderId: null,
        seq: 5,
      },
    });
    expect(store.getState().fills.A101).toEqual(retained);
  });

  it("does not transfer the previous occupant's forced or A-Day metadata to a replacement", () => {
    const store = createBidStore({ bidSessionId: 'X', initialSeq: 5, meMemberId: 17 });
    store.setState({
      fills: {
        A101: {
          memberId: 17,
          ordinal: 1,
          bidId: 'old-award',
          aDay: 'G3',
          forced: { commandId: 'old-force', actorMemberId: 99, reason: '', atMs: 1 },
        },
      },
    });
    store.getState().applyEvent({
      v: 1,
      type: 'state_snapshot',
      seq: 6,
      ts: 0,
      payload: {
        fills: [{ positionId: 'A101', memberId: 18, ordinal: 2 }],
        currentBidderId: 19,
        seq: 6,
      },
    });
    expect(store.getState().fills.A101).toEqual({ memberId: 18, ordinal: 2, bidId: '' });
  });

  it('retains saved provenance on a sparse pick event but never invents it from forced_pick', () => {
    const store = createBidStore({ bidSessionId: 'X', initialSeq: 5, meMemberId: 17 });
    const forced = { commandId: 'saved-force', actorMemberId: 99, reason: '', atMs: 1 };
    store.setState({
      fills: { A101: { memberId: 17, ordinal: 1, bidId: 'saved-award', aDay: 'G3', forced } },
    });
    store.getState().applyEvent({
      v: 1,
      type: 'pick_made',
      seq: 6,
      ts: 0,
      payload: {
        positionId: 'A101',
        memberId: 17,
        ordinal: 1,
        bidId: 'saved-award',
        nextBidderId: 18,
        idempotencyKey: 'synthetic',
      },
    });
    expect(store.getState().fills.A101).toMatchObject({ aDay: 'G3', forced });
    const before = store.getState().fills;
    store.getState().applyEvent({
      v: 1,
      type: 'forced_pick',
      seq: 7,
      ts: 0,
      payload: {
        positionId: 'A102',
        memberId: 18,
        ordinal: 2,
        bidId: 'legacy-forced-event',
        reason: 'Legacy event',
      },
    });
    expect(store.getState().fills).toEqual(before);
    expect(store.getState().fills.A102).toBeUndefined();
  });

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
        aDay: null,
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
        aDay: null,
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
        aDay: null,
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

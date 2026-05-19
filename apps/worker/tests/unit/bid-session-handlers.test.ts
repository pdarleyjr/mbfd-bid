import type { EligibilityResult } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import {
  type HandlerEnv,
  handleForcePick,
  handleFreeze,
  handleSkip,
  handleSubmitPick,
} from '../../src/durable/bid-session-handlers.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';

const eligible: EligibilityResult = {
  eligible: true,
  reasons: [],
  points: 5,
  soPoints: 0,
  moPoints: 0,
  breakdown: { total: 5, soTotal: 0, moTotal: 0, itemized: [] },
};
const ineligible: EligibilityResult = {
  eligible: false,
  reasons: [{ code: 'CRED_MISSING', label: 'Missing X', satisfied: false }],
  points: 0,
  soPoints: 0,
  moPoints: 0,
  breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
};

function activeState(): BidSessionState {
  return {
    ...emptyBidSessionState('01HSESS'),
    currentPhase: 'position_bid',
    currentBidderId: 17,
    turnStartedAtMs: 1700000000000,
    turnTimerSeconds: 180,
    bidOrder: [
      { ordinal: 1, memberId: 17, pool: 'OFC' },
      { ordinal: 2, memberId: 18, pool: 'OFC' },
      { ordinal: 3, memberId: 19, pool: 'FF' },
    ],
    queueCursor: 0,
  };
}

function env(check: 'eligible' | 'ineligible' = 'eligible'): HandlerEnv {
  return {
    nowMs: () => 1700000001000,
    newBidId: () => '01HBID',
    evaluateEligibility: () => (check === 'eligible' ? eligible : ineligible),
  };
}

describe('handleSubmitPick (Plan 04 Task 5)', () => {
  it('accepts when sender is current bidder and position is open and eligible', () => {
    const state = activeState();
    const r = handleSubmitPick(state, env(), {
      senderMemberId: 17,
      positionId: 'A101',
      rDay: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.kind).toBe('accepted');
    if (r.kind !== 'accepted') {
      return;
    }
    expect(r.newState.fills.A101).toBeDefined();
    expect(r.newState.queueCursor).toBe(1);
    expect(r.newState.currentBidderId).toBe(18);
    expect(r.newState.lastSeq).toBe(state.lastSeq + 1);
    expect(r.event.type).toBe('pick_made');
  });

  it('rejects when sender is not current bidder', () => {
    const state = activeState();
    const r = handleSubmitPick(state, env(), {
      senderMemberId: 99,
      positionId: 'A101',
      rDay: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') {
      return;
    }
    expect(r.code).toBe('NOT_YOUR_TURN');
  });

  it('rejects when position already filled', () => {
    const state = activeState();
    state.fills.A101 = { memberId: 22, ordinal: 99, bidId: 'X' };
    const r = handleSubmitPick(state, env(), {
      senderMemberId: 17,
      positionId: 'A101',
      rDay: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') {
      return;
    }
    expect(r.code).toBe('POSITION_FILLED');
  });

  it('rejects when eligibility engine says not eligible', () => {
    const state = activeState();
    const r = handleSubmitPick(state, env('ineligible'), {
      senderMemberId: 17,
      positionId: 'A101',
      rDay: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') {
      return;
    }
    expect(r.code).toBe('NOT_ELIGIBLE');
  });

  it('rejects when session is frozen', () => {
    const state = { ...activeState(), frozenAt: 1700000000500 };
    const r = handleSubmitPick(state, env(), {
      senderMemberId: 17,
      positionId: 'A101',
      rDay: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') {
      return;
    }
    expect(r.code).toBe('SESSION_FROZEN');
  });

  it('rejects when session phase is paused', () => {
    const state: BidSessionState = { ...activeState(), currentPhase: 'paused' };
    const r = handleSubmitPick(state, env(), {
      senderMemberId: 17,
      positionId: 'A101',
      rDay: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') {
      return;
    }
    expect(r.code).toBe('SESSION_PAUSED');
  });

  it('advances queueCursor past the last entry → currentPhase=complete', () => {
    const state = activeState();
    state.queueCursor = 2;
    state.currentBidderId = 19;
    const r = handleSubmitPick(state, env(), {
      senderMemberId: 19,
      positionId: 'A101',
      rDay: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.kind).toBe('accepted');
    if (r.kind !== 'accepted') {
      return;
    }
    expect(r.newState.currentPhase).toBe('complete');
    expect(r.newState.currentBidderId).toBeNull();
  });
});

describe('handleSkip (Plan 04 Task 5)', () => {
  it('admin skip advances cursor and emits skip event with reason', () => {
    const state = activeState();
    const r = handleSkip(state, env(), {
      adminActorId: 0,
      reason: 'Bidder unreachable past 2x timer',
    });
    expect(r.kind).toBe('accepted');
    if (r.kind !== 'accepted') {
      return;
    }
    expect(r.newState.queueCursor).toBe(1);
    expect(r.newState.currentBidderId).toBe(18);
    expect(r.event.type).toBe('skip');
  });

  it('rejects skip when session frozen', () => {
    const state = { ...activeState(), frozenAt: 1700000000500 };
    const r = handleSkip(state, env(), { adminActorId: 0, reason: 'x' });
    expect(r.kind).toBe('rejected');
  });
});

describe('handleForcePick (Plan 04 Task 5)', () => {
  it('admin force-pick bypasses eligibility check', () => {
    const state = activeState();
    const r = handleForcePick(state, env('ineligible'), {
      adminActorId: 0,
      targetMemberId: 17,
      positionId: 'A101',
      reason: 'Last qualified candidate, mandatory minimum',
    });
    expect(r.kind).toBe('accepted');
    if (r.kind !== 'accepted') {
      return;
    }
    expect(r.event.type).toBe('forced_pick');
    expect(r.newState.fills.A101?.memberId).toBe(17);
  });

  it('rejects force-pick on a position already filled', () => {
    const state = activeState();
    state.fills.A101 = { memberId: 22, ordinal: 1, bidId: 'X' };
    const r = handleForcePick(state, env(), {
      adminActorId: 0,
      targetMemberId: 17,
      positionId: 'A101',
      reason: 'x',
    });
    expect(r.kind).toBe('rejected');
  });
});

describe('handleFreeze (Plan 04 Task 5)', () => {
  it('sets frozenAt and freezeActorId', () => {
    const state = activeState();
    const r = handleFreeze(state, env(), {
      adminActorId: 0,
      reason: 'Network outage at venue',
    });
    expect(r.kind).toBe('accepted');
    if (r.kind !== 'accepted') {
      return;
    }
    expect(r.newState.frozenAt).toBe(1700000001000);
    expect(r.newState.currentPhase).toBe('paused');
  });

  it('re-freeze is a no-op', () => {
    const state = { ...activeState(), frozenAt: 1700000000500 };
    const r = handleFreeze(state, env(), { adminActorId: 0, reason: 'x' });
    expect(r.kind).toBe('rejected');
  });
});

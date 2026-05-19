import { describe, expect, it } from 'vitest';
import {
  auditEntryForForcedPick,
  auditEntryForFreeze,
  auditEntryForPickMade,
  auditEntryForSkip,
} from '../../src/lib/audit.js';

describe('audit entry builders (Plan 04 Task 10)', () => {
  it('builds pick row with action=pick and target_kind=position', () => {
    const row = auditEntryForPickMade({
      bidSessionId: '01HSESS',
      seq: 5,
      bidId: '01HBID',
      memberId: 17,
      positionId: 'A101',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      nowMs: 1700000000000,
    });
    expect(row.action).toBe('pick');
    expect(row.actorType).toBe('member');
    expect(row.targetKind).toBe('position');
    expect(row.targetId).toBe('A101');
    expect(row.seq).toBe(5);
  });

  it('forced_pick rows carry admin actor and reason', () => {
    const row = auditEntryForForcedPick({
      bidSessionId: '01HSESS',
      seq: 6,
      bidId: '01HBID',
      adminActorId: 0,
      targetMemberId: 17,
      positionId: 'A101',
      reason: 'Last qualified candidate',
      nowMs: 1700000000000,
    });
    expect(row.action).toBe('forced_pick');
    expect(row.actorType).toBe('admin');
    expect(row.actorId).toBe(0);
    expect(row.reason).toBe('Last qualified candidate');
  });

  it('skip rows include reason text', () => {
    const row = auditEntryForSkip({
      bidSessionId: '01HSESS',
      seq: 7,
      adminActorId: 0,
      skippedMemberId: 17,
      reason: 'Bidder unreachable past 2x timer',
      nowMs: 1700000000000,
    });
    expect(row.action).toBe('skip');
  });

  it('freeze rows carry reason', () => {
    const row = auditEntryForFreeze({
      bidSessionId: '01HSESS',
      seq: 8,
      adminActorId: 0,
      reason: 'Network outage at venue',
      nowMs: 1700000000000,
    });
    expect(row.action).toBe('pause');
    expect(row.reason).toMatch(/freeze/i);
  });
});

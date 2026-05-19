import { describe, expect, it } from 'vitest';
import {
  BidForMemberSchema,
  DayEndSchema,
  DayStartSchema,
  ForcePickSchema,
  LockPositionSchema,
  PauseSessionSchema,
  ResumeSessionSchema,
  SkipSchema,
  TimerConfigSchema,
} from '../../src/schemas/admin-actions.js';

describe('ForcePickSchema', () => {
  it('accepts a valid payload', () => {
    const ok = ForcePickSchema.parse({
      member_id: 42,
      position_id: 'A205',
      reason_code: 'force.reverse_seniority',
      reason: 'No qualified bidders remain.',
    });
    expect(ok.member_id).toBe(42);
  });

  it('rejects empty reason', () => {
    expect(() =>
      ForcePickSchema.parse({
        member_id: 1,
        position_id: 'A205',
        reason_code: 'force.reverse_seniority',
        reason: '',
      }),
    ).toThrow();
  });

  it('rejects reason shorter than 4 chars', () => {
    expect(() =>
      ForcePickSchema.parse({
        member_id: 1,
        position_id: 'A205',
        reason_code: 'force.reverse_seniority',
        reason: 'lol',
      }),
    ).toThrow();
  });

  it('rejects non-force reason_code', () => {
    expect(() =>
      ForcePickSchema.parse({
        member_id: 1,
        position_id: 'A205',
        reason_code: 'skip.unreachable',
        reason: 'whatever',
      }),
    ).toThrow();
  });

  it('rejects non-positive member_id', () => {
    expect(() =>
      ForcePickSchema.parse({
        member_id: 0,
        position_id: 'A205',
        reason_code: 'force.cert_mandate',
        reason: 'reason text',
      }),
    ).toThrow();
  });
});

describe('SkipSchema', () => {
  it('accepts skip.unreachable', () => {
    const ok = SkipSchema.parse({
      member_id: 7,
      reason_code: 'skip.unreachable',
      reason: 'No answer on phone.',
    });
    expect(ok.reason_code).toBe('skip.unreachable');
  });

  it('rejects a force code', () => {
    expect(() =>
      SkipSchema.parse({
        member_id: 7,
        reason_code: 'force.reverse_seniority',
        reason: 'wrong tool',
      }),
    ).toThrow();
  });
});

describe('BidForMemberSchema', () => {
  it('accepts payload without a_day', () => {
    const ok = BidForMemberSchema.parse({
      member_id: 5,
      position_id: 'B102',
      reason_code: 'bid_for_member.unreachable_phone',
      reason: 'Member confirmed pick on radio.',
    });
    expect(ok.a_day).toBeUndefined();
  });

  it('accepts payload with a_day', () => {
    const ok = BidForMemberSchema.parse({
      member_id: 5,
      position_id: 'D101',
      a_day: 'Mon',
      reason_code: 'bid_for_member.unreachable_phone',
      reason: 'D-shift weekday confirmed.',
    });
    expect(ok.a_day).toBe('Mon');
  });

  it('rejects invalid a_day value', () => {
    expect(() =>
      BidForMemberSchema.parse({
        member_id: 5,
        position_id: 'D101',
        a_day: 'Tue',
        reason_code: 'bid_for_member.unreachable_phone',
        reason: 'wrong day',
      }),
    ).toThrow();
  });
});

describe('LockPositionSchema', () => {
  it('accepts a valid probationary lock', () => {
    const ok = LockPositionSchema.parse({
      member_id: 99,
      position_id: 'A105',
      reason_code: 'lock_position.probationary_placement',
      reason: 'New hire probationary placement.',
    });
    expect(ok.member_id).toBe(99);
  });
});

describe('PauseSessionSchema', () => {
  it('accepts session.pause_emergency', () => {
    const ok = PauseSessionSchema.parse({
      reason_code: 'session.pause_emergency',
      reason: 'Network outage in admin room.',
    });
    expect(ok.reason_code).toBe('session.pause_emergency');
  });
});

describe('ResumeSessionSchema', () => {
  it('accepts an empty body (resume needs no payload)', () => {
    expect(ResumeSessionSchema.parse({})).toEqual({});
  });
});

describe('DayEndSchema', () => {
  it('accepts ISO 8601 UTC resume timestamp', () => {
    const ok = DayEndSchema.parse({
      scheduled_resume_at: '2026-11-15T13:00:00.000Z',
      reason: 'End of bid day 1.',
    });
    expect(ok.scheduled_resume_at).toBe('2026-11-15T13:00:00.000Z');
  });

  it('rejects non-ISO timestamp', () => {
    expect(() =>
      DayEndSchema.parse({ scheduled_resume_at: 'tomorrow 9am', reason: 'x' }),
    ).toThrow();
  });
});

describe('DayStartSchema', () => {
  it('accepts an empty body', () => {
    expect(DayStartSchema.parse({})).toEqual({});
  });
});

describe('TimerConfigSchema', () => {
  it('accepts turn_timer_seconds = 180', () => {
    expect(TimerConfigSchema.parse({ turn_timer_seconds: 180 })).toEqual({
      turn_timer_seconds: 180,
    });
  });

  it('rejects values below 30', () => {
    expect(() => TimerConfigSchema.parse({ turn_timer_seconds: 5 })).toThrow();
  });

  it('rejects values above 600', () => {
    expect(() => TimerConfigSchema.parse({ turn_timer_seconds: 9999 })).toThrow();
  });
});

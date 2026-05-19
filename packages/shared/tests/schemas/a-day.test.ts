import { describe, expect, it } from 'vitest';
import {
  ADayGroupIdSchema,
  ADayPickMadeMessageSchema,
  ADayRejectMessageSchema,
  PhaseChangedMessageSchema,
  SubmitADayPickRequestSchema,
  WeekdaySchema,
} from '../../src/schemas/a-day.js';

describe('ADayGroupIdSchema', () => {
  it('accepts G1-G4', () => {
    for (const v of ['G1', 'G2', 'G3', 'G4']) {
      expect(ADayGroupIdSchema.safeParse(v).success).toBe(true);
    }
  });
  it('rejects G5', () => {
    expect(ADayGroupIdSchema.safeParse('G5').success).toBe(false);
  });
});

describe('WeekdaySchema', () => {
  it('accepts MON-SUN', () => {
    for (const v of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
      expect(WeekdaySchema.safeParse(v).success).toBe(true);
    }
  });
});

describe('SubmitADayPickRequestSchema', () => {
  it('accepts a valid request', () => {
    const r = SubmitADayPickRequestSchema.safeParse({
      v: 1,
      bidSessionId: 'sess-2026-01',
      aDay: 'G2',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown aDay value', () => {
    const r = SubmitADayPickRequestSchema.safeParse({
      v: 1,
      bidSessionId: 'x',
      aDay: 'XYZ',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(r.success).toBe(false);
  });

  it('rejects when v != 1', () => {
    const r = SubmitADayPickRequestSchema.safeParse({
      v: 2,
      bidSessionId: 'x',
      aDay: 'G1',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(r.success).toBe(false);
  });
});

describe('ADayPickMadeMessageSchema', () => {
  it('accepts a server-broadcast pick-made message', () => {
    const r = ADayPickMadeMessageSchema.safeParse({
      type: 'a_day_pick_made',
      v: 1,
      seq: 41,
      memberId: 123,
      shift: 'A',
      aDay: 'G2',
      pickedAtMs: 1717000000000,
      forced: false,
      adminActorId: null,
      nextMemberId: 124,
      meters: {
        groups: [],
        weekdays: [],
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('PhaseChangedMessageSchema', () => {
  it('accepts position_bid → a_day_bid', () => {
    const r = PhaseChangedMessageSchema.safeParse({
      type: 'phase_changed',
      v: 1,
      from: 'position_bid',
      to: 'a_day_bid',
      bidOrderPhase2: [1, 2, 3],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a_day_bid → complete', () => {
    const r = PhaseChangedMessageSchema.safeParse({
      type: 'phase_changed',
      v: 1,
      from: 'a_day_bid',
      to: 'complete',
    });
    expect(r.success).toBe(true);
  });
});

describe('ADayRejectMessageSchema', () => {
  it('accepts a structured reject', () => {
    const r = ADayRejectMessageSchema.safeParse({
      type: 'a_day_reject',
      v: 1,
      memberId: 5,
      reasonCode: 'GROUP_FULL',
      reasonLabel: 'Group G1 on A-shift is full (19/19).',
    });
    expect(r.success).toBe(true);
  });
});

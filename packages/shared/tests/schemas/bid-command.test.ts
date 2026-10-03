import { describe, expect, it } from 'vitest';
import {
  LiveBidCommandSchema,
  MockFreezeCommandSchema,
  MockFreezeRequestSchema,
} from '../../src/index.js';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

describe('systemic reviewed adjustment envelopes', () => {
  it('accepts optional exact turn identities and rejects ambiguous or unexpected turn fields', () => {
    const command = {
      v: 1,
      type: 'live.alter_order',
      commandId: COMMAND_ID,
      bidSessionId: 'synthetic-session',
      expectedSeq: 3,
      actor: { id: 99, role: 'admin' },
      reason: 'Reviewed direction',
      evidenceReference: null,
      orderedRemainingMemberIds: [42, 42],
      orderedRemainingTurns: [
        { memberId: 42, stageId: 'captains' },
        { memberId: 42, stageId: null },
      ],
    };
    expect(LiveBidCommandSchema.safeParse(command).success).toBe(true);
    for (const turn of [
      { memberId: 42 },
      { memberId: 0, stageId: 'captains' },
      { memberId: 42, stageId: ' ' },
      { memberId: 42, stageId: 'captains', stage_label: 'Untrusted label' },
    ])
      expect(
        LiveBidCommandSchema.safeParse({ ...command, orderedRemainingTurns: [turn] }).success,
      ).toBe(false);
  });

  it.each([
    { type: 'live.record_a_day', memberId: 42, aDay: 'G2' },
    { type: 'live.alter_order', orderedRemainingMemberIds: [42, 43] },
    {
      type: 'live.set_exceptional_assignment',
      memberId: 42,
      operation: 'ASSIGN',
      roleLabel: 'Temporary duty',
    },
  ])('keeps $type on the same strict authenticated command contract', (fields) => {
    const command = {
      v: 1,
      commandId: COMMAND_ID,
      bidSessionId: 'synthetic-session',
      expectedSeq: 3,
      actor: { id: 99, role: 'admin' },
      reason: 'Reviewed direction',
      evidenceReference: null,
      ...fields,
      adminOverride: { acknowledged: true, warningCodes: ['ORDER_DEVIATION'] },
    };
    expect(LiveBidCommandSchema.safeParse(command).success).toBe(true);
    expect(
      LiveBidCommandSchema.safeParse({ ...command, actor: { id: 99, role: 'member' } }).success,
    ).toBe(false);
    expect(
      LiveBidCommandSchema.safeParse({
        ...command,
        adminOverride: { acknowledged: false, warningCodes: [] },
      }).success,
    ).toBe(false);
    expect(
      LiveBidCommandSchema.safeParse({ ...command, unexpected: 'unreviewed data' }).success,
    ).toBe(false);
  });
});

describe('mock freeze command schemas', () => {
  it('accepts a complete versioned command envelope', () => {
    const result = MockFreezeCommandSchema.safeParse({
      v: 1,
      type: 'mock.freeze',
      commandId: COMMAND_ID,
      bidSessionId: '01HZZ0000000000000MOCKCMD1',
      expectedSeq: 7,
      actor: { id: 0, role: 'admin' },
      reason: 'Mock exercise pause',
    });

    expect(result.success).toBe(true);
  });

  it('rejects malformed command identity, sequence, and unknown fields', () => {
    const base = {
      v: 1,
      type: 'mock.freeze',
      commandId: COMMAND_ID,
      bidSessionId: '01HZZ0000000000000MOCKCMD1',
      expectedSeq: 7,
      actor: { id: 0, role: 'admin' },
      reason: 'Mock exercise pause',
    };

    expect(MockFreezeCommandSchema.safeParse({ ...base, commandId: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(MockFreezeCommandSchema.safeParse({ ...base, expectedSeq: -1 }).success).toBe(false);
    expect(MockFreezeCommandSchema.safeParse({ ...base, unexpected: true }).success).toBe(false);
  });

  it('keeps the HTTP request surface free of actor and session identity', () => {
    expect(
      MockFreezeRequestSchema.safeParse({ expectedSeq: 7, reason: 'Mock exercise pause' }).success,
    ).toBe(true);
    expect(
      MockFreezeRequestSchema.safeParse({
        expectedSeq: 7,
        reason: 'Mock exercise pause',
        actor: { id: 99, role: 'admin' },
      }).success,
    ).toBe(false);
    expect(
      MockFreezeRequestSchema.safeParse({
        expectedSeq: 7,
        reason: 'Mock exercise pause',
        bidSessionId: 'client-supplied-session',
      }).success,
    ).toBe(false);
  });
});

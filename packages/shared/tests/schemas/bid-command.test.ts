import { describe, expect, it } from 'vitest';
import {
  LiveBidCommandSchema,
  MockFreezeCommandSchema,
  MockFreezeRequestSchema,
} from '../../src/index.js';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

describe('systemic reviewed adjustment envelopes', () => {
  it('keeps source confirmation optional for historical envelopes and validates supplied digests', () => {
    const command = {
      v: 1,
      type: 'live.pause',
      commandId: COMMAND_ID,
      bidSessionId: 'synthetic-session',
      expectedSeq: 3,
      actor: { id: 99, role: 'admin' },
      evidenceReference: null,
    };
    expect(LiveBidCommandSchema.parse(command)).not.toHaveProperty('expectedScoreReceiptSha256');
    for (const digest of [null, 'a'.repeat(64)])
      expect(
        LiveBidCommandSchema.safeParse({ ...command, expectedScoreReceiptSha256: digest }).success,
      ).toBe(true);
    for (const digest of ['', 'a'.repeat(63), 'A'.repeat(64), 7])
      expect(
        LiveBidCommandSchema.safeParse({ ...command, expectedScoreReceiptSha256: digest }).success,
      ).toBe(false);
  });
  it.each([
    {
      type: 'live.record_selection',
      memberId: 42,
      positionId: 'A101',
      adminOverride: { acknowledged: true, warningCodes: [] },
    },
    { type: 'live.force_selection', memberId: 42, positionId: 'A101' },
    { type: 'live.disposition', memberId: 42, disposition: 'SKIP' },
    { type: 'live.record_a_day', memberId: 42, aDay: 'G2' },
    { type: 'live.alter_order', orderedRemainingMemberIds: [42, 43] },
    {
      type: 'live.set_exceptional_assignment',
      memberId: 42,
      operation: 'ASSIGN',
      roleLabel: 'Temporary duty',
    },
    { type: 'live.pause' },
    { type: 'live.resume' },
    {
      type: 'live.start_specialty_adjudication',
      specialtyId: 'specialty',
      positionId: 'A101',
      candidateMemberIds: [42],
    },
    { type: 'live.resolve_specialty_candidate', memberId: 42, outcome: 'ACCEPT' },
    { type: 'live.close_specialty_adjudication' },
    {
      type: 'live.correct_bid',
      memberId: 42,
      originalCommandId: COMMAND_ID,
      originalBidId: 'award-1',
      originalPositionId: 'A101',
      originalADayCommandId: null,
      operation: 'REVOKE',
      replacement: null,
    },
  ])('accepts an optional note for $type and keeps the note length bound', (fields) => {
    const command = {
      v: 1,
      commandId: COMMAND_ID,
      bidSessionId: 'synthetic-session',
      expectedSeq: 3,
      actor: { id: 99, role: 'admin' },
      evidenceReference: null,
      ...fields,
    };
    expect(LiveBidCommandSchema.parse(command).reason).toBe('');
    const historicallyTrimmed =
      fields.type === 'live.correct_bid' || fields.type === 'live.set_exceptional_assignment';
    expect(LiveBidCommandSchema.parse({ ...command, reason: '  ' }).reason).toBe(
      historicallyTrimmed ? '' : '  ',
    );
    expect(LiveBidCommandSchema.parse({ ...command, reason: '  OK  ' }).reason).toBe(
      historicallyTrimmed ? 'OK' : '  OK  ',
    );
    expect(LiveBidCommandSchema.safeParse({ ...command, reason: 'x'.repeat(501) }).success).toBe(
      false,
    );
    expect(
      LiveBidCommandSchema.safeParse({ ...command, actor: { id: 99, role: 'member' } }).success,
    ).toBe(false);
  });

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
  it('allows freezing without a typed note while retaining sequence and strict input', () => {
    expect(MockFreezeRequestSchema.parse({ expectedSeq: 7 })).toEqual({
      expectedSeq: 7,
      reason: '',
    });
    expect(MockFreezeRequestSchema.parse({ expectedSeq: 7, reason: '   ' }).reason).toBe('   ');
    expect(
      MockFreezeRequestSchema.safeParse({ expectedSeq: 7, reason: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
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

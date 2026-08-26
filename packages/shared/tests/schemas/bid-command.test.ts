import { describe, expect, it } from 'vitest';
import { MockFreezeCommandSchema, MockFreezeRequestSchema } from '../../src/index.js';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

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

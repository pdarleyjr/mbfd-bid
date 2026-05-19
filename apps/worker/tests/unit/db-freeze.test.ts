import { describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';

describe('bid_sessions freeze columns (Plan 04 Task 1)', () => {
  it('exposes frozen_at column', () => {
    expect(schema.bidSessions.frozenAt).toBeDefined();
  });

  it('exposes freeze_actor_id column referencing members', () => {
    expect(schema.bidSessions.freezeActorId).toBeDefined();
  });

  it('exposes freeze_reason text column', () => {
    expect(schema.bidSessions.freezeReason).toBeDefined();
  });
});

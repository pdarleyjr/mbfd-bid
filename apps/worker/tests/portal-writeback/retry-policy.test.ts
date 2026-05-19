import { describe, expect, it } from 'vitest';

import {
  RETRY_MAX_ATTEMPTS,
  RETRY_MAX_DELAY_MS,
  nextAttempt,
} from '../../src/portal-writeback/retry-policy.js';

describe('retry-policy (Plan 08 Task 19)', () => {
  it('RETRY_MAX_ATTEMPTS = 24', () => {
    expect(RETRY_MAX_ATTEMPTS).toBe(24);
  });

  it('RETRY_MAX_DELAY_MS = 24h', () => {
    expect(RETRY_MAX_DELAY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('attempt 1 delay ≈ 2s ± jitter', () => {
    const r = nextAttempt({ attempts: 1, nowMs: 1_000_000, rng: () => 0 });
    expect(r.kind).toBe('retry');
    if (r.kind === 'retry') expect(r.nextAttemptAtMs).toBe(1_000_000 + 2_000);
  });

  it('attempt 5 delay = 32s', () => {
    const r = nextAttempt({ attempts: 5, nowMs: 0, rng: () => 0 });
    if (r.kind === 'retry') expect(r.nextAttemptAtMs).toBe(32_000);
  });

  it('attempt 10 delay = 1024s', () => {
    const r = nextAttempt({ attempts: 10, nowMs: 0, rng: () => 0 });
    if (r.kind === 'retry') expect(r.nextAttemptAtMs).toBe(1_024_000);
  });

  it('attempt 11+ delay capped at 24h', () => {
    const r = nextAttempt({ attempts: 23, nowMs: 0, rng: () => 0 });
    if (r.kind === 'retry')
      expect(r.nextAttemptAtMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
  });

  it('attempt 25 returns permanent_failure', () => {
    const r = nextAttempt({ attempts: 25, nowMs: 0, rng: () => 0 });
    expect(r.kind).toBe('permanent_failure');
  });

  it('jitter is in 0..1000ms range', () => {
    const a = nextAttempt({ attempts: 1, nowMs: 0, rng: () => 0 });
    const b = nextAttempt({ attempts: 1, nowMs: 0, rng: () => 0.999 });
    if (a.kind === 'retry' && b.kind === 'retry') {
      expect(b.nextAttemptAtMs - a.nextAttemptAtMs).toBeLessThan(1000);
    }
  });

  it('all math is integer (no fractional ms)', () => {
    for (let i = 1; i <= 24; i++) {
      const r = nextAttempt({ attempts: i, nowMs: 0, rng: () => 0.5 });
      if (r.kind === 'retry') {
        expect(Number.isInteger(r.nextAttemptAtMs)).toBe(true);
      }
    }
  });
});

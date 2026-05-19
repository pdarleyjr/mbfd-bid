// Plan 08 Task 19 — Integer-safe exponential backoff for portal retries.
//
//   delay_ms = 2^min(attempts, 10) * 1000   (integer shift; no Math.pow)
//   capped at RETRY_MAX_DELAY_MS (24h)
//   plus 0..999 ms of jitter
//
// All math is integer (D12). Floats compound rounding errors over a
// 24-hour retry window and lead to spurious requeues.

export const RETRY_MAX_ATTEMPTS = 24;
export const RETRY_MAX_DELAY_MS = 24 * 60 * 60 * 1000;
const EXP_CAP = 10; // 2^10 = 1024 seconds ≈ 17 minutes
const JITTER_MAX_MS = 1000;

export type RetryDecision =
  | { kind: 'retry'; nextAttemptAtMs: number }
  | { kind: 'permanent_failure' };

export interface NextAttemptArgs {
  /** Number of attempts already made (1 = "first attempt just failed"). */
  attempts: number;
  nowMs: number;
  /** Injectable RNG for deterministic tests. */
  rng?: () => number;
}

export function nextAttempt(a: NextAttemptArgs): RetryDecision {
  if (a.attempts > RETRY_MAX_ATTEMPTS) {
    return { kind: 'permanent_failure' };
  }
  const exp = Math.min(Math.max(a.attempts, 1), EXP_CAP);
  const baseMs = (1 << exp) * 1000;
  const cappedMs = Math.min(baseMs, RETRY_MAX_DELAY_MS);
  const rng = a.rng ?? Math.random;
  const jitter = Math.floor(rng() * JITTER_MAX_MS);
  return { kind: 'retry', nextAttemptAtMs: a.nowMs + cappedMs + jitter };
}

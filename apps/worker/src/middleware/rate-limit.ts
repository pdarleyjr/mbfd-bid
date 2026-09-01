// Plan 09 Task 3 — KV-backed sliding-window rate limit for /auth/*.
//
// Two callers in the auth flow:
//   - rateLimitByIp(kv, ip, 5, 60)            — 5 attempts per IP per minute
//   - rateLimitByEmployeeId(kv, eid, 10, 900) — 10 attempts per employee_id per 15min
//
// The IP / employee_id is SHA-256 hashed before being used as the KV key so
// the rate-limit data structure does not store raw PII. A request that is
// blocked returns the seconds until the oldest hit in the window ages out,
// so the caller can set a `Retry-After` header that's never wrong by more
// than 1 second.
//
// KV failures are propagated to the caller. The authentication route turns
// them into a generic 503 so an outage cannot silently remove brute-force
// protection. This is intentionally distinct from malformed stored values,
// which are treated as an empty window and immediately overwritten.
//
// Concurrency note: the read-modify-write is racy because KV does not offer
// optimistic concurrency. In the worst case under high concurrency a small
// number of additional requests slip through within a single window — the
// limit is approximate, not exact. This is the standard trade-off for
// KV-backed sliding-window limiters.

import { createHash } from 'node:crypto';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function hashKey(prefix: string, identifier: string): string {
  const h = createHash('sha256').update(identifier).digest('hex').slice(0, 16);
  return `rl:${prefix}:${h}`;
}

function parseTimestamps(raw: string | null): number[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  } catch {
    return [];
  }
}

/**
 * Approximate sliding-window limiter. Reads the array of recent hit
 * timestamps, drops anything older than `windowSec`, and either appends a
 * new timestamp (allowed) or returns the seconds until the oldest hit ages
 * out (denied).
 *
 * `clock` is injected to keep tests deterministic. Production callers pass
 * the default (Date.now-based).
 */
export async function slidingWindow(
  kv: KvLike,
  key: string,
  limit: number,
  windowSec: number,
  clock: () => number = () => Math.floor(Date.now() / 1000),
): Promise<RateLimitResult> {
  const now = clock();
  const raw = await kv.get(key);
  const timestamps = parseTimestamps(raw);
  const cutoff = now - windowSec;
  const recent = timestamps.filter((t) => t > cutoff);
  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, oldest + windowSec - now);
    return { allowed: false, retryAfterSec, remaining: 0 };
  }
  recent.push(now);
  await kv.put(key, JSON.stringify(recent), { expirationTtl: windowSec + 5 });
  return { allowed: true, retryAfterSec: 0, remaining: limit - recent.length };
}

/** Per-IP limiter. Default: 5 attempts per minute. */
export async function rateLimitByIp(
  kv: KvLike,
  ip: string,
  limit = 5,
  windowSec = 60,
): Promise<RateLimitResult> {
  return slidingWindow(kv, hashKey('ip', ip), limit, windowSec);
}

/** Per-employee_id limiter. Default: 10 attempts per 15 minutes. */
export async function rateLimitByEmployeeId(
  kv: KvLike,
  employeeId: string,
  limit = 10,
  windowSec = 900,
): Promise<RateLimitResult> {
  return slidingWindow(kv, hashKey('emp', employeeId), limit, windowSec);
}

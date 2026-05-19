// Plan 09 Task 3 — Rate limit middleware tests.
//
// Uses a small in-memory KV stub instead of Miniflare so tests stay
// dependency-light. The stub matches the surface that
// `apps/worker/src/middleware/rate-limit.ts` consumes:
//
//   - `get(key): Promise<string | null>`
//   - `put(key, value, { expirationTtl }): Promise<void>`
//
// The KV namespace types in `@cloudflare/workers-types` are intentionally
// loose, so a plain Map-backed fake is sufficient.

import type { KVNamespace } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  rateLimitByEmployeeId,
  rateLimitByIp,
} from '../../src/middleware/rate-limit.js';

type FakeKv = KVNamespace & { store: Map<string, string> };

function makeKv(): FakeKv {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as FakeKv;
}

describe('rateLimitByIp', () => {
  let kv: FakeKv;

  beforeEach(() => {
    kv = makeKv();
  });

  it('allows the first 5 requests in a minute', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await rateLimitByIp(kv, '1.2.3.4', 5, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - (i + 1));
    }
  });

  it('blocks the 6th request in a minute with retryAfterSec > 0', async () => {
    for (let i = 0; i < 5; i++) await rateLimitByIp(kv, '1.2.3.4', 5, 60);
    const result = await rateLimitByIp(kv, '1.2.3.4', 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
    expect(result.retryAfterSec).toBeLessThanOrEqual(60);
    expect(result.remaining).toBe(0);
  });

  it('isolates buckets per-IP (one bad IP does not lock out a neighbor)', async () => {
    for (let i = 0; i < 5; i++) await rateLimitByIp(kv, '1.2.3.4', 5, 60);
    const blocked = await rateLimitByIp(kv, '1.2.3.4', 5, 60);
    expect(blocked.allowed).toBe(false);
    const fresh = await rateLimitByIp(kv, '5.6.7.8', 5, 60);
    expect(fresh.allowed).toBe(true);
  });

  it('does not store the raw IP — the KV key is a hashed prefix', async () => {
    await rateLimitByIp(kv, '203.0.113.42', 5, 60);
    const keys = [...kv.store.keys()];
    expect(keys.length).toBe(1);
    const key = keys[0] ?? '';
    expect(key.startsWith('rl:ip:')).toBe(true);
    expect(key.includes('203.0.113.42')).toBe(false);
  });

  it('honors custom limit + window', async () => {
    const r1 = await rateLimitByIp(kv, '9.9.9.9', 2, 30);
    const r2 = await rateLimitByIp(kv, '9.9.9.9', 2, 30);
    const r3 = await rateLimitByIp(kv, '9.9.9.9', 2, 30);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
  });
});

describe('rateLimitByEmployeeId', () => {
  let kv: FakeKv;

  beforeEach(() => {
    kv = makeKv();
  });

  it('uses a separate bucket prefix from rateLimitByIp', async () => {
    await rateLimitByEmployeeId(kv, '12345', 10, 900);
    await rateLimitByIp(kv, '12345', 5, 60);
    const keys = [...kv.store.keys()].sort();
    expect(keys.length).toBe(2);
    expect(keys.some((k) => k.startsWith('rl:emp:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('rl:ip:'))).toBe(true);
  });

  it('blocks the 11th attempt within the 15-minute window', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await rateLimitByEmployeeId(kv, '12345', 10, 900);
      expect(r.allowed).toBe(true);
    }
    const eleventh = await rateLimitByEmployeeId(kv, '12345', 10, 900);
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.retryAfterSec).toBeGreaterThan(0);
  });

  it('does not store the raw employee_id', async () => {
    await rateLimitByEmployeeId(kv, '54321', 10, 900);
    const keys = [...kv.store.keys()];
    const k = keys[0] ?? '';
    expect(k.includes('54321')).toBe(false);
  });
});

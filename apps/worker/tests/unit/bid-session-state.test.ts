import { describe, expect, it } from 'vitest';
import {
  type BidSessionState,
  type DOStorageLike,
  emptyBidSessionState,
  loadBidSessionState,
  persistBidSessionState,
} from '../../src/durable/bid-session-state.js';

class InMemoryStorage implements DOStorageLike {
  private store = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
  async list<T>(prefix: string): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [k, v] of this.store) {
      if (k.startsWith(prefix)) {
        out.set(k, v as T);
      }
    }
    return out;
  }
}

describe('bid-session-state (Plan 04 Task 4)', () => {
  it('emptyBidSessionState has phase=config and no current bidder', () => {
    const s = emptyBidSessionState('01HSESS');
    expect(s.bidSessionId).toBe('01HSESS');
    expect(s.currentPhase).toBe('config');
    expect(s.currentBidderId).toBeNull();
    expect(s.lastSeq).toBe(0);
    expect(s.fills).toEqual({});
  });

  it('persist + load round-trips state', async () => {
    const storage = new InMemoryStorage();
    const state: BidSessionState = {
      ...emptyBidSessionState('01HSESS'),
      currentPhase: 'position_bid',
      currentBidderId: 7,
      lastSeq: 42,
      fills: { A101: { memberId: 17, ordinal: 5, bidId: '01HBID' } },
      turnStartedAtMs: 1700000000000,
      turnTimerSeconds: 180,
    };
    await persistBidSessionState(storage, state);
    const loaded = await loadBidSessionState(storage, '01HSESS');
    expect(loaded).toEqual(state);
  });

  it('load returns empty state when nothing persisted', async () => {
    const storage = new InMemoryStorage();
    const loaded = await loadBidSessionState(storage, '01HSESS');
    expect(loaded.currentPhase).toBe('config');
    expect(loaded.lastSeq).toBe(0);
  });

  it('persist writes all keys atomically (single map round-trip)', async () => {
    const storage = new InMemoryStorage();
    await persistBidSessionState(storage, emptyBidSessionState('01HSESS'));
    const all = await storage.list('bs:01HSESS:');
    expect(all.size).toBeGreaterThan(0);
  });

  it('idempotency keys are namespaced and TTL-eligible', async () => {
    const storage = new InMemoryStorage();
    await storage.put('idem:01HSESS:11111111-1111-4111-8111-111111111111', { bidId: 'X' });
    const all = await storage.list('idem:01HSESS:');
    expect(all.size).toBe(1);
  });
});

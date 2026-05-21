import type { KVNamespace } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMBER_BID_PIN,
  MEMBER_BID_PIN_KV_KEY,
  constantTimeEqual,
  getBidPin,
  isValidPin,
  setBidPin,
} from '../../src/lib/bid-pin.js';

/** Minimal in-memory KV stub — supports the subset of KVNamespace we use. */
function makeKv(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return {
        keys: Array.from(store.keys()).map((name) => ({ name })),
        list_complete: true,
        cursor: undefined as unknown as string,
      };
    },
  } as unknown as KVNamespace;
}

describe('isValidPin', () => {
  it('accepts 4–8 digit strings', () => {
    expect(isValidPin('2300')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
  });

  it('rejects short, long, or non-numeric input', () => {
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('')).toBe(false);
    expect(isValidPin(2300 as unknown as string)).toBe(false);
  });
});

describe('getBidPin', () => {
  it('returns the default (2300) when KV is empty', async () => {
    const kv = makeKv();
    const setting = await getBidPin(kv);
    expect(setting.pin).toBe(DEFAULT_MEMBER_BID_PIN);
    expect(setting.updatedAt).toBe(0);
    expect(setting.updatedBy).toBeNull();
  });

  it('returns the default when KV holds malformed JSON', async () => {
    const kv = makeKv({ [MEMBER_BID_PIN_KV_KEY]: '{not json' });
    const setting = await getBidPin(kv);
    expect(setting.pin).toBe(DEFAULT_MEMBER_BID_PIN);
  });

  it('returns the default when the stored PIN is invalid shape', async () => {
    const kv = makeKv({
      [MEMBER_BID_PIN_KV_KEY]: JSON.stringify({ pin: 'abc', updatedAt: 1 }),
    });
    const setting = await getBidPin(kv);
    expect(setting.pin).toBe(DEFAULT_MEMBER_BID_PIN);
  });

  it('returns the stored setting when valid', async () => {
    const kv = makeKv({
      [MEMBER_BID_PIN_KV_KEY]: JSON.stringify({
        pin: '4040',
        updatedAt: 1700000000000,
        updatedBy: 'admin@example',
      }),
    });
    const setting = await getBidPin(kv);
    expect(setting.pin).toBe('4040');
    expect(setting.updatedAt).toBe(1700000000000);
    expect(setting.updatedBy).toBe('admin@example');
  });
});

describe('setBidPin', () => {
  it('persists a new PIN with a fresh timestamp', async () => {
    const kv = makeKv();
    const before = Date.now();
    const setting = await setBidPin(kv, '9090', 'admin');
    expect(setting.pin).toBe('9090');
    expect(setting.updatedAt).toBeGreaterThanOrEqual(before);
    expect(setting.updatedBy).toBe('admin');
    // Round-trip through getBidPin.
    const reread = await getBidPin(kv);
    expect(reread.pin).toBe('9090');
    expect(reread.updatedBy).toBe('admin');
  });

  it('rejects invalid PINs', async () => {
    const kv = makeKv();
    await expect(setBidPin(kv, '12', 'admin')).rejects.toThrow('invalid_pin');
    await expect(setBidPin(kv, 'abcd', 'admin')).rejects.toThrow('invalid_pin');
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('2300', '2300')).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(constantTimeEqual('2300', '23001')).toBe(false);
  });

  it('returns false for different content', () => {
    expect(constantTimeEqual('2300', '2301')).toBe(false);
  });
});

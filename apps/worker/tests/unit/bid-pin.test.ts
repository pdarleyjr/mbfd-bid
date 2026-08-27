import type { KVNamespace } from '@cloudflare/workers-types';
import { describe, expect, it } from 'vitest';
import {
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
    expect(isValidPin('1357')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
  });

  it('rejects short, long, or non-numeric input', () => {
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('')).toBe(false);
    expect(isValidPin(1357 as unknown as string)).toBe(false);
  });
});

describe('getBidPin', () => {
  it('reports a missing setting when KV is empty', async () => {
    const kv = makeKv();
    const result = await getBidPin(kv);
    expect(result).toEqual({ kind: 'missing' });
  });

  it('reports a malformed setting when KV holds malformed JSON', async () => {
    const kv = makeKv({ [MEMBER_BID_PIN_KV_KEY]: '{not json' });
    const result = await getBidPin(kv);
    expect(result).toEqual({ kind: 'malformed' });
  });

  it('reports a malformed setting when the stored PIN has an invalid shape', async () => {
    const kv = makeKv({
      [MEMBER_BID_PIN_KV_KEY]: JSON.stringify({ pin: 'abc', updatedAt: 1 }),
    });
    const result = await getBidPin(kv);
    expect(result).toEqual({ kind: 'malformed' });
  });

  it('reports an unavailable setting when KV reads fail', async () => {
    const kv = makeKv();
    kv.get = async () => {
      throw new Error('KV unavailable');
    };
    const result = await getBidPin(kv);
    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('returns the stored setting when valid', async () => {
    const kv = makeKv({
      [MEMBER_BID_PIN_KV_KEY]: JSON.stringify({
        pin: '4040',
        updatedAt: 1700000000000,
        updatedBy: 'admin@example',
      }),
    });
    const result = await getBidPin(kv);
    expect(result).toEqual({
      kind: 'configured',
      setting: {
        pin: '4040',
        updatedAt: 1700000000000,
        updatedBy: 'admin@example',
      },
    });
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
    expect(reread).toEqual({ kind: 'configured', setting });
  });

  it('rejects invalid PINs', async () => {
    const kv = makeKv();
    await expect(setBidPin(kv, '12', 'admin')).rejects.toThrow('invalid_pin');
    await expect(setBidPin(kv, 'abcd', 'admin')).rejects.toThrow('invalid_pin');
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('1357', '1357')).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(constantTimeEqual('1357', '13579')).toBe(false);
  });

  it('returns false for different content', () => {
    expect(constantTimeEqual('1357', '1358')).toBe(false);
  });
});

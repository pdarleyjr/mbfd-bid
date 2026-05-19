import type { KVNamespace } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COST_KEY_PREFIX,
  addSessionCostCents,
  getSessionCostCents,
} from '../../src/ai/cost-accounting.js';

type FakeKv = KVNamespace & { store: Map<string, string> };

function makeKv(): FakeKv {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as FakeKv;
}

describe('cost-accounting', () => {
  let kv: FakeKv;
  beforeEach(() => {
    kv = makeKv();
  });

  it('returns 0 when no key', async () => {
    expect(await getSessionCostCents(kv, 'sess1')).toBe(0);
  });

  it('add then get matches', async () => {
    await addSessionCostCents(kv, 'sess1', 7);
    expect(await getSessionCostCents(kv, 'sess1')).toBe(7);
  });

  it('multiple adds accumulate', async () => {
    await addSessionCostCents(kv, 'sess1', 7);
    await addSessionCostCents(kv, 'sess1', 13);
    expect(await getSessionCostCents(kv, 'sess1')).toBe(20);
  });

  it('per-session isolation', async () => {
    await addSessionCostCents(kv, 'sessA', 5);
    await addSessionCostCents(kv, 'sessB', 9);
    expect(await getSessionCostCents(kv, 'sessA')).toBe(5);
    expect(await getSessionCostCents(kv, 'sessB')).toBe(9);
  });

  it('storage key uses COST_KEY_PREFIX', async () => {
    await addSessionCostCents(kv, 'X', 1);
    expect([...kv.store.keys()][0]).toBe(`${COST_KEY_PREFIX}X`);
  });
});

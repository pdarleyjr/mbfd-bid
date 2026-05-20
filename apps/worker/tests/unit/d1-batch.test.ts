import { describe, expect, it, vi } from 'vitest';
import { chunkedInArrayMutate, chunkedInArraySelect } from '../../src/lib/d1-batch.js';

describe('chunkedInArraySelect', () => {
  it('returns [] on empty input without calling the fetcher', async () => {
    const fetcher = vi.fn();
    const out = await chunkedInArraySelect<number, { id: number }>([], fetcher);
    expect(out).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('splits >100 ids into <=90 sized batches and concatenates results', async () => {
    // 250 ids → simulates a roster of 250 members (well over D1's ~100-param cap).
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const seenChunks: number[][] = [];

    const out = await chunkedInArraySelect<number, { memberId: number }>(ids, (chunk) => {
      seenChunks.push([...chunk]);
      return Promise.resolve(chunk.map((id) => ({ memberId: id })));
    });

    // Each chunk must be at or under the D1 placeholder ceiling.
    for (const chunk of seenChunks) {
      expect(chunk.length).toBeLessThanOrEqual(90);
    }
    // Concatenated results match the full input set, in order.
    expect(out.map((r) => r.memberId)).toEqual(ids);
    // 250 / 90 ⇒ 3 chunks (90 + 90 + 70).
    expect(seenChunks).toHaveLength(3);
    expect(seenChunks[0]?.length).toBe(90);
    expect(seenChunks[1]?.length).toBe(90);
    expect(seenChunks[2]?.length).toBe(70);
  });

  it('respects a custom chunk size', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => i + 1);
    const seenChunks: number[][] = [];
    await chunkedInArraySelect<number, number>(
      ids,
      (chunk) => {
        seenChunks.push([...chunk]);
        return Promise.resolve(chunk);
      },
      10,
    );
    expect(seenChunks.map((c) => c.length)).toEqual([10, 10, 5]);
  });
});

describe('chunkedInArrayMutate', () => {
  it('returns 0 on empty input without calling the mutator', async () => {
    const mutator = vi.fn();
    const count = await chunkedInArrayMutate<number>([], mutator);
    expect(count).toBe(0);
    expect(mutator).not.toHaveBeenCalled();
  });

  it('runs one mutation per chunk for a 250-id payload', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const calls: number[][] = [];
    const count = await chunkedInArrayMutate<number>(ids, (chunk) => {
      calls.push([...chunk]);
      return Promise.resolve();
    });
    expect(count).toBe(3);
    expect(calls).toHaveLength(3);
    for (const chunk of calls) {
      expect(chunk.length).toBeLessThanOrEqual(90);
    }
  });
});

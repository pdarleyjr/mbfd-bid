import { describe, expect, it } from 'vitest';

import { ChunkHeaderSchema } from '../../src/schemas/audit-chunk.js';

describe('ChunkHeaderSchema', () => {
  it('accepts a valid header', () => {
    const h = ChunkHeaderSchema.parse({
      chunk_seq: 12,
      prev_chunk_sha256: 'a'.repeat(64),
      events_in_chunk: 100,
      min_seq: 1100,
      max_seq: 1199,
      signature: 'b'.repeat(86),
      pubkey: 'c'.repeat(43),
      signed_at: '2026-09-22T14:23:00Z',
    });
    expect(h.chunk_seq).toBe(12);
  });

  it('accepts a null prev_chunk_sha256 (first chunk in session)', () => {
    const h = ChunkHeaderSchema.parse({
      chunk_seq: 1,
      prev_chunk_sha256: null,
      events_in_chunk: 1,
      min_seq: 1,
      max_seq: 1,
      signature: 'b'.repeat(86),
      pubkey: 'c'.repeat(43),
      signed_at: '2026-09-22T14:23:00Z',
    });
    expect(h.prev_chunk_sha256).toBeNull();
  });

  it('rejects negative seq', () => {
    expect(() =>
      ChunkHeaderSchema.parse({
        chunk_seq: -1,
        prev_chunk_sha256: 'a'.repeat(64),
        events_in_chunk: 1,
        min_seq: 1,
        max_seq: 1,
        signature: 'x',
        pubkey: 'x',
        signed_at: '2026-09-22T14:23:00Z',
      }),
    ).toThrow();
  });

  it('rejects malformed prev_chunk_sha256 length', () => {
    expect(() =>
      ChunkHeaderSchema.parse({
        chunk_seq: 1,
        prev_chunk_sha256: 'a'.repeat(10),
        events_in_chunk: 1,
        min_seq: 1,
        max_seq: 1,
        signature: 'x',
        pubkey: 'x',
        signed_at: '2026-09-22T14:23:00Z',
      }),
    ).toThrow();
  });
});

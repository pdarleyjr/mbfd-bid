import type { AuditEvent } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';

import { GENESIS_PREV, computeChunkHash } from '../../src/audit/hash-chain.js';

const events: AuditEvent[] = [
  {
    seq: 1,
    bid_session_id: '01HF3',
    action: 'session_start',
    actor_type: 'admin',
    actor_id: 1,
    created_at: '2026-09-22T14:00:00Z',
  },
  {
    seq: 2,
    bid_session_id: '01HF3',
    action: 'pick',
    actor_type: 'member',
    actor_id: 42,
    target_kind: 'position',
    target_id: 'A101',
    created_at: '2026-09-22T14:01:00Z',
  },
];

describe('computeChunkHash', () => {
  it('returns 64-char lowercase hex SHA-256', () => {
    expect(computeChunkHash(GENESIS_PREV, events)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(computeChunkHash(GENESIS_PREV, events)).toBe(computeChunkHash(GENESIS_PREV, events));
  });

  it('changes if any event byte changes', () => {
    const tampered: AuditEvent[] = [
      { ...(events[0] as AuditEvent) },
      { ...(events[1] as AuditEvent), target_id: 'A102' },
    ];
    expect(computeChunkHash(GENESIS_PREV, events)).not.toBe(
      computeChunkHash(GENESIS_PREV, tampered),
    );
  });

  it('changes if event order changes', () => {
    expect(computeChunkHash(GENESIS_PREV, events)).not.toBe(
      computeChunkHash(GENESIS_PREV, [events[1] as AuditEvent, events[0] as AuditEvent]),
    );
  });

  it('changes if prev_chunk_sha256 changes', () => {
    expect(computeChunkHash(GENESIS_PREV, events)).not.toBe(
      computeChunkHash('a'.repeat(64), events),
    );
  });

  it('GENESIS_PREV is null', () => {
    expect(GENESIS_PREV).toBe(null);
  });

  it('rejects empty events', () => {
    expect(() => computeChunkHash(GENESIS_PREV, [])).toThrow(/empty/);
  });
});

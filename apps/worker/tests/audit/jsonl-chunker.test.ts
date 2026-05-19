import type { AuditEvent } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';

import {
  FLUSH_THRESHOLD_EVENTS,
  FLUSH_TIMEOUT_MS,
  JsonlChunker,
} from '../../src/audit/jsonl-chunker.js';

function mkEvent(seq: number): AuditEvent {
  return {
    seq,
    bid_session_id: '01HF3',
    action: 'pick',
    actor_type: 'member',
    actor_id: 42,
    target_kind: 'position',
    target_id: `A${100 + seq}`,
    created_at: '2026-09-22T14:00:00Z',
  };
}

describe('JsonlChunker', () => {
  it('FLUSH_THRESHOLD_EVENTS is 100', () => {
    expect(FLUSH_THRESHOLD_EVENTS).toBe(100);
  });

  it('FLUSH_TIMEOUT_MS is 30_000', () => {
    expect(FLUSH_TIMEOUT_MS).toBe(30_000);
  });

  it('add() returns null when buffer is below threshold', () => {
    const c = new JsonlChunker();
    for (let i = 0; i < 99; i++) {
      expect(c.add(mkEvent(i), Date.now())).toBe(null);
    }
  });

  it('add() returns flush instruction when buffer hits 100 events', () => {
    const c = new JsonlChunker();
    for (let i = 0; i < 99; i++) c.add(mkEvent(i), Date.now());
    const out = c.add(mkEvent(99), Date.now());
    expect(out).not.toBe(null);
    expect(out?.events).toHaveLength(100);
    expect(out?.reason).toBe('threshold');
  });

  it('flushIfStale() returns null when buffer is fresh', () => {
    const c = new JsonlChunker();
    const t0 = 1_000_000;
    c.add(mkEvent(0), t0);
    expect(c.flushIfStale(t0 + 29_000)).toBe(null);
  });

  it('flushIfStale() returns flush when 30s elapsed', () => {
    const c = new JsonlChunker();
    const t0 = 1_000_000;
    c.add(mkEvent(0), t0);
    const out = c.flushIfStale(t0 + 30_000);
    expect(out).not.toBe(null);
    expect(out?.events).toHaveLength(1);
    expect(out?.reason).toBe('timeout');
  });

  it('flushIfStale() returns null when buffer is empty', () => {
    const c = new JsonlChunker();
    expect(c.flushIfStale(Date.now())).toBe(null);
  });

  it('add() after a flush starts a fresh buffer with new timer', () => {
    const c = new JsonlChunker();
    const t0 = 1_000_000;
    for (let i = 0; i < 100; i++) c.add(mkEvent(i), t0);
    // buffer is empty here; next add starts a new timer at t0+1000
    c.add(mkEvent(100), t0 + 1_000);
    expect(c.flushIfStale(t0 + 1_000 + 29_000)).toBe(null);
    expect(c.flushIfStale(t0 + 1_000 + 30_000)).not.toBe(null);
  });

  it('drain() returns remaining events and clears the buffer', () => {
    const c = new JsonlChunker();
    c.add(mkEvent(0), Date.now());
    c.add(mkEvent(1), Date.now());
    const out = c.drain();
    expect(out?.events).toHaveLength(2);
    expect(c.drain()).toBe(null);
    expect(c.hasPending()).toBe(false);
  });

  it('hasPending() / size() reflect buffer state', () => {
    const c = new JsonlChunker();
    expect(c.hasPending()).toBe(false);
    expect(c.size()).toBe(0);
    c.add(mkEvent(0), Date.now());
    expect(c.hasPending()).toBe(true);
    expect(c.size()).toBe(1);
  });
});

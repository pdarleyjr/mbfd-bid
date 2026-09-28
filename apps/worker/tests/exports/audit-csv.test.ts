import type { R2Bucket } from '@cloudflare/workers-types';
import { inflate } from 'pako';
import { describe, expect, it, vi } from 'vitest';

import { type AuditCsvDb, exportAuditCsv } from '../../src/exports/audit-csv.js';

function makeFakeDb(rowCount: number): AuditCsvDb {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    id: `evt_${i + 1}`,
    bid_session_id: '01HF3',
    seq: i + 1,
    actor_type: 'member',
    actor_id: 42,
    action: 'pick',
    target_kind: 'position',
    target_id: 'A101',
    before_state: null,
    after_state: null,
    reason: null,
    ai_advisory_id: null,
    client_meta: null,
    created_at: new Date('2026-09-22T14:00:00Z').getTime(),
  }));
  return {
    pageRows: vi.fn(async (offset: number, limit: number) => rows.slice(offset, offset + limit)),
    count: vi.fn(async () => rowCount),
  };
}

describe('exportAuditCsv (Plan 08 Task 15)', () => {
  it('pages 250 rows, gzips, uploads a known-length body, returns r2Key + signed URL', async () => {
    const db = makeFakeDb(250);
    const r2Put = vi.fn(async (_key: string, body: Uint8Array) => {
      if (!(body instanceof Uint8Array)) throw new Error('R2 requires a known-length body');
    });
    const signed = vi.fn(async () => 'https://signed.example.com/x');
    const t0 = Date.now();
    const out = await exportAuditCsv({
      bidSessionId: '01HF3',
      year: 2026,
      db,
      r2: { put: r2Put } as unknown as R2Bucket,
      signUrl: signed,
      now: () => Date.now(),
    });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2000);
    expect(r2Put).toHaveBeenCalledTimes(1);
    expect(r2Put.mock.calls[0]?.[1].byteLength).toBe(out.bytesGzipped);
    expect(out.r2Key).toMatch(/^2026\/01HF3\/audit_full_\d+\.csv\.gz$/);
    expect(out.signedUrl).toBe('https://signed.example.com/x');
    expect(out.rowCount).toBe(250);
  });

  it('produces a valid gzipped CSV with header + 250 data rows', async () => {
    const db = makeFakeDb(250);
    let captured: Uint8Array | null = null;
    const r2 = {
      put: async (_key: string, body: Uint8Array) => {
        if (!(body instanceof Uint8Array)) throw new Error('R2 requires a known-length body');
        captured = body;
      },
    } as unknown as R2Bucket;
    await exportAuditCsv({
      bidSessionId: '01HF3',
      year: 2026,
      db,
      r2,
      signUrl: async () => 'x',
      now: () => Date.now(),
    });
    expect(captured).not.toBe(null);
    const inflated = new TextDecoder().decode(inflate(captured as unknown as Uint8Array));
    const lines = inflated.trim().split('\n');
    expect(lines).toHaveLength(251); // 1 header + 250
    expect(lines[0]).toMatch(/^id,bid_session_id,seq,/);
  });

  it('handles empty result', async () => {
    const db = makeFakeDb(0);
    const out = await exportAuditCsv({
      bidSessionId: '01HF3',
      year: 2026,
      db,
      r2: { put: vi.fn() } as unknown as R2Bucket,
      signUrl: async () => 'x',
      now: () => Date.now(),
    });
    expect(out.rowCount).toBe(0);
  });

  it('pages large audit states without requesting the entire session at once', async () => {
    const state = 'x'.repeat(96_000);
    const db: AuditCsvDb = {
      pageRows: vi.fn(async (offset, limit) =>
        Array.from({ length: Math.max(0, Math.min(limit, 235 - offset)) }, (_, i) => ({
          id: `evt_${offset + i}`,
          after_state: state,
        })),
      ),
      count: vi.fn(async () => 235),
    };
    const out = await exportAuditCsv({
      bidSessionId: '01HF3',
      year: 2026,
      db,
      r2: {
        put: async (_key: string, body: Uint8Array) => {
          if (!(body instanceof Uint8Array)) throw new Error('R2 requires a known-length body');
        },
      } as unknown as R2Bucket,
      signUrl: async () => 'x',
      now: () => Date.now(),
    });
    expect(out.rowCount).toBe(235);
    expect(db.pageRows).toHaveBeenCalledTimes(10);
    expect(db.pageRows).toHaveBeenCalledWith(0, 25);
    expect(out.bytesGzipped).toBeGreaterThan(0);
  });

  it('uses uniform known-length R2 parts when gzip output exceeds 5 MiB', async () => {
    let seed = 0x12345678;
    const random = new Uint8Array(12 * 1024 * 1024);
    for (let i = 0; i < random.length; i += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      random[i] = seed & 0xff;
    }
    const payload = Array.from(random, (byte) => String.fromCharCode(33 + (byte % 90))).join('');
    const db: AuditCsvDb = {
      pageRows: vi.fn(async (offset) =>
        offset === 0 ? [{ id: 'evt_large', after_state: payload }] : [],
      ),
      count: vi.fn(async () => 1),
    };
    const parts: Uint8Array[] = [];
    const abort = vi.fn();
    const complete = vi.fn(async () => ({}));
    const uploadPart = vi.fn(async (number: number, body: Uint8Array) => {
      if (!(body instanceof Uint8Array)) throw new Error('R2 requires a known-length part');
      parts.push(body.slice());
      return { partNumber: number, etag: String(number) };
    });
    const createMultipartUpload = vi.fn(async () => ({ uploadPart, complete, abort }));
    const put = vi.fn();
    const out = await exportAuditCsv({
      bidSessionId: '01HF3',
      year: 2026,
      db,
      r2: { put, createMultipartUpload } as unknown as R2Bucket,
      signUrl: async () => 'x',
      now: () => Date.now(),
    });
    expect(out.rowCount).toBe(1);
    expect(put).not.toHaveBeenCalled();
    expect(createMultipartUpload).toHaveBeenCalledTimes(1);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts.slice(0, -1)) expect(part.byteLength).toBe(5 * 1024 * 1024);
    expect(parts.reduce((sum, part) => sum + part.byteLength, 0)).toBe(out.bytesGzipped);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
  });
});

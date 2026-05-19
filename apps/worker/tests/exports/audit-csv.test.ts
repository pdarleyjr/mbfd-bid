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
  it('streams 250 rows, gzips, uploads, returns r2Key + signed URL', async () => {
    const db = makeFakeDb(250);
    const r2Put = vi.fn(async () => {});
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
    expect(out.r2Key).toMatch(/^2026\/01HF3\/audit_full_\d+\.csv\.gz$/);
    expect(out.signedUrl).toBe('https://signed.example.com/x');
    expect(out.rowCount).toBe(250);
  });

  it('produces a valid gzipped CSV with header + 250 data rows', async () => {
    const db = makeFakeDb(250);
    let captured: Uint8Array | null = null;
    const r2 = {
      put: async (_key: string, body: ArrayBuffer | Uint8Array | string) => {
        captured =
          typeof body === 'string'
            ? new TextEncoder().encode(body)
            : body instanceof Uint8Array
              ? body
              : new Uint8Array(body);
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
});

import type { R2Bucket } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';

import { generateRosterPdf } from '../../src/exports/roster-pdf.js';

describe('generateRosterPdf (Plan 08 Task 14)', () => {
  it('POSTs to Browserless and uploads the PDF to R2', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
    const fetchSpy = vi.fn(
      async () =>
        new Response(pdfBytes.buffer.slice(0) as ArrayBuffer, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
    );
    const r2Put = vi.fn(async () => {});
    const result = await generateRosterPdf({
      shift: 'A',
      sessionId: '01HF3',
      year: 2026,
      browserlessToken: 'BROWSERLESS_TEST',
      printTokenSecret: 'PRINT_SECRET',
      webBaseUrl: 'https://staging.bid.mbfdhub.com',
      r2: { put: r2Put } as unknown as R2Bucket,
      fetchImpl: fetchSpy,
      now: () => 1730000000000,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calls = fetchSpy.mock.calls as unknown as [[string | URL, unknown]];
    const calledWith = calls[0][0];
    expect(String(calledWith)).toMatch(/chrome\.browserless\.io\/pdf/);
    expect(r2Put).toHaveBeenCalledTimes(1);
    expect(result.r2Key).toBe('2026/01HF3/A_Shift_1730000000000.pdf');
    expect(result.bytes).toBe(pdfBytes.length);
  });

  it('throws when Browserless returns non-200', async () => {
    const fetchSpy = vi.fn(async () => new Response('boom', { status: 502 }));
    await expect(
      generateRosterPdf({
        shift: 'A',
        sessionId: '01HF3',
        year: 2026,
        browserlessToken: 't',
        printTokenSecret: 's',
        webBaseUrl: 'https://x',
        r2: { put: vi.fn() } as unknown as R2Bucket,
        fetchImpl: fetchSpy,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/Browserless/);
  });

  it('rejects unknown shift', async () => {
    await expect(
      generateRosterPdf({
        shift: 'Z' as 'A',
        sessionId: 'x',
        year: 2026,
        browserlessToken: 't',
        printTokenSecret: 's',
        webBaseUrl: 'https://x',
        r2: {} as R2Bucket,
        fetchImpl: vi.fn(),
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/shift/);
  });
});

import type { Fetcher, R2Bucket } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';

// Mock @cloudflare/puppeteer before the SUT is imported so the default-import
// `puppeteer.launch(env.BROWSER)` resolves to our mock. vi.mock is hoisted
// above imports; vi.hoisted lets the factory and the assertions share state.
const puppeteerMocks = vi.hoisted(() => {
  const pageMock = {
    goto: vi.fn(async (_url: string, _opts?: unknown) => undefined),
    pdf: vi.fn(async (_opts?: unknown) => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
  };
  const browserMock = {
    newPage: vi.fn(async () => pageMock),
    close: vi.fn(async () => undefined),
  };
  const launch = vi.fn(async (_binding: unknown) => browserMock);
  return { pageMock, browserMock, launch };
});

vi.mock('@cloudflare/puppeteer', () => ({
  default: { launch: puppeteerMocks.launch },
}));

import { generateRosterPdf } from '../../src/exports/roster-pdf.js';

const browserBinding = { fetch: vi.fn() } as unknown as Fetcher;

describe('generateRosterPdf (Browser Rendering refactor)', () => {
  it('launches puppeteer with env.BROWSER, navigates the print URL and uploads PDF to R2', async () => {
    puppeteerMocks.launch.mockClear();
    puppeteerMocks.browserMock.newPage.mockClear();
    puppeteerMocks.browserMock.close.mockClear();
    puppeteerMocks.pageMock.goto.mockClear();
    puppeteerMocks.pageMock.pdf.mockClear();

    const r2Put = vi.fn(async () => {});
    const result = await generateRosterPdf({
      shift: 'A',
      sessionId: '01HF3',
      year: 2026,
      browser: browserBinding,
      printTokenSecret: 'PRINT_SECRET',
      webBaseUrl: 'https://staging.bid.mbfdhub.com',
      r2: { put: r2Put } as unknown as R2Bucket,
      now: () => 1730000000000,
    });

    expect(puppeteerMocks.launch).toHaveBeenCalledTimes(1);
    expect(puppeteerMocks.launch).toHaveBeenCalledWith(browserBinding);
    expect(puppeteerMocks.browserMock.newPage).toHaveBeenCalledTimes(1);
    expect(puppeteerMocks.pageMock.goto).toHaveBeenCalledTimes(1);

    const gotoCalls = puppeteerMocks.pageMock.goto.mock.calls as Array<
      [string, { waitUntil?: string; timeout?: number } | undefined]
    >;
    const firstGoto = gotoCalls[0];
    expect(firstGoto).toBeDefined();
    expect(String(firstGoto?.[0] ?? '')).toMatch(/staging\.bid\.mbfdhub\.com/);
    expect(String(firstGoto?.[0] ?? '')).toMatch(/\/admin\/exports\/render\/roster\/A\/01HF3/);
    expect(String(firstGoto?.[0] ?? '')).toMatch(/token=/);
    expect(firstGoto?.[1]).toMatchObject({ waitUntil: 'networkidle0' });

    expect(puppeteerMocks.pageMock.pdf).toHaveBeenCalledTimes(1);
    const pdfCalls = puppeteerMocks.pageMock.pdf.mock.calls as Array<
      [{ format?: string; printBackground?: boolean } | undefined]
    >;
    expect(pdfCalls[0]?.[0]).toMatchObject({
      format: 'Letter',
      printBackground: true,
    });

    expect(puppeteerMocks.browserMock.close).toHaveBeenCalledTimes(1);

    expect(r2Put).toHaveBeenCalledTimes(1);
    expect(result.r2Key).toBe('2026/01HF3/A_Shift_1730000000000.pdf');
    expect(result.bytes).toBe(4);
  });

  it('closes the browser even when page.pdf() throws', async () => {
    puppeteerMocks.launch.mockClear();
    puppeteerMocks.browserMock.close.mockClear();
    puppeteerMocks.pageMock.pdf.mockClear();
    puppeteerMocks.pageMock.pdf.mockRejectedValueOnce(new Error('render boom'));

    await expect(
      generateRosterPdf({
        shift: 'A',
        sessionId: '01HF3',
        year: 2026,
        browser: browserBinding,
        printTokenSecret: 's',
        webBaseUrl: 'https://x',
        r2: { put: vi.fn() } as unknown as R2Bucket,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/render boom/);

    expect(puppeteerMocks.browserMock.close).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown shift', async () => {
    await expect(
      generateRosterPdf({
        shift: 'Z' as 'A',
        sessionId: 'x',
        year: 2026,
        browser: browserBinding,
        printTokenSecret: 's',
        webBaseUrl: 'https://x',
        r2: {} as R2Bucket,
        now: () => Date.now(),
      }),
    ).rejects.toThrow(/shift/);
  });
});

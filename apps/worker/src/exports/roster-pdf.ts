// Plan 08 Task 14 — Generate a roster PDF via Cloudflare Browser Rendering.
//
// Mints a 5-min HMAC print-token, navigates a headless Chromium (via the
// `env.BROWSER` Workers binding + `@cloudflare/puppeteer`) to the web RSC
// roster page, renders it to PDF, and uploads the bytes to R2 under
// `<year>/<session_id>/<shift>_Shift_<nowMs>.pdf`. Browser Rendering failures
// propagate so the admin trigger handler can surface a 502.
//
// History: this used to POST to https://chrome.browserless.io/pdf with a
// BROWSERLESS_TOKEN. The $5 Workers Paid plan now includes Browser Rendering,
// so we use the first-party binding and drop the external dependency.

import puppeteer from '@cloudflare/puppeteer';
import type { Fetcher, R2Bucket } from '@cloudflare/workers-types';

import { mintPrintToken } from './print-token.js';

export interface RosterPdfArgs {
  shift: 'A' | 'B' | 'C' | 'D';
  sessionId: string;
  year: number;
  /** Cloudflare Browser Rendering binding (`[browser] binding = "BROWSER"`). */
  browser: Fetcher;
  printTokenSecret: string;
  /** Public base URL of the web app (e.g. https://staging.bid.mbfdhub.com). */
  webBaseUrl: string;
  r2: R2Bucket;
  now: () => number;
}

export interface RosterPdfResult {
  r2Key: string;
  bytes: number;
  generatedAtMs: number;
}

const VALID_SHIFTS: ReadonlyArray<RosterPdfArgs['shift']> = ['A', 'B', 'C', 'D'];

export async function generateRosterPdf(args: RosterPdfArgs): Promise<RosterPdfResult> {
  if (!VALID_SHIFTS.includes(args.shift)) {
    throw new Error(`Invalid shift: ${args.shift}`);
  }
  const token = mintPrintToken(
    { kind: 'roster', shift: args.shift, session_id: args.sessionId },
    args.printTokenSecret,
    300,
    args.now(),
  );
  const renderUrl = `${args.webBaseUrl}/admin/exports/render/roster/${
    args.shift
  }/${encodeURIComponent(args.sessionId)}?token=${encodeURIComponent(token)}`;

  // puppeteer.launch(env.BROWSER) returns a browser bound to the Browser
  // Rendering API endpoint behind the Worker's `[browser]` binding. The
  // `@cloudflare/puppeteer` types accept a Fetcher binding here.
  const browser = await puppeteer.launch(
    args.browser as unknown as Parameters<typeof puppeteer.launch>[0],
  );
  let pdfBytes: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.goto(renderUrl, { waitUntil: 'networkidle0', timeout: 30_000 });
    const buf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
      preferCSSPageSize: true,
    });
    pdfBytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  } finally {
    await browser.close();
  }

  const generatedAtMs = args.now();
  const r2Key = `${args.year}/${args.sessionId}/${args.shift}_Shift_${generatedAtMs}.pdf`;
  await args.r2.put(r2Key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  return { r2Key, bytes: pdfBytes.byteLength, generatedAtMs };
}

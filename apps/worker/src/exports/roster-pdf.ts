// Plan 08 Task 14 — Generate a roster PDF via Browserless.
//
// Mints a 5-min HMAC print-token, asks Browserless to render the web RSC
// page to PDF, and uploads the bytes to R2 under
// `<year>/<session_id>/<shift>_Shift_<nowMs>.pdf`. Browserless failures
// propagate so the admin trigger handler can surface a 502/422.

import type { R2Bucket } from '@cloudflare/workers-types';

import { mintPrintToken } from './print-token.js';

export interface RosterPdfArgs {
  shift: 'A' | 'B' | 'C' | 'D';
  sessionId: string;
  year: number;
  browserlessToken: string;
  printTokenSecret: string;
  /** Public base URL of the web app (e.g. https://staging.bid.mbfdhub.com). */
  webBaseUrl: string;
  r2: R2Bucket;
  fetchImpl: typeof fetch;
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

  const browserlessUrl = `https://chrome.browserless.io/pdf?token=${encodeURIComponent(
    args.browserlessToken,
  )}`;
  const res = await args.fetchImpl(browserlessUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: renderUrl,
      options: {
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
        preferCSSPageSize: true,
      },
      waitForTimeout: 2000,
      waitForSelector: '.station-block',
    }),
  });
  if (res.status !== 200) {
    const text = await res.text().catch(() => '');
    throw new Error(`Browserless returned ${res.status}: ${text}`);
  }
  const buf = await res.arrayBuffer();
  const generatedAtMs = args.now();
  const r2Key = `${args.year}/${args.sessionId}/${args.shift}_Shift_${generatedAtMs}.pdf`;
  await args.r2.put(r2Key, buf, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  return { r2Key, bytes: buf.byteLength, generatedAtMs };
}

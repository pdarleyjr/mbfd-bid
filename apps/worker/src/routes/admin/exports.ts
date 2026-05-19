// Plan 08 Task 17 — Admin export trigger + list endpoints.
//
// Endpoints:
//   POST /print-token             Mint a 5-min HMAC token for Browserless
//   POST /roster/:shift           Generate + upload roster PDF for shift
//   POST /audit-csv               Stream audit_log → gzip → R2 + return signed URL
//   GET  /:session_id             List exports for a session (R2 listing)
//
// Write endpoints require step-up auth (Plan 05 `requireStepUpAuth`).
// Bucket name resolves from env.R2_EXPORTS_BUCKET_NAME with a sensible
// per-environment default. Signed-URL credentials (R2_ACCESS_KEY_ID etc.)
// come from Wrangler secrets — if missing the worker returns 503 so the
// admin gets a clear error instead of an opaque crash.

import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import { auditCsvDbFromD1 } from '../../exports/audit-csv-db.js';
import { exportAuditCsv } from '../../exports/audit-csv.js';
import { mintPrintToken } from '../../exports/print-token.js';
import { generateRosterPdf } from '../../exports/roster-pdf.js';
import { createSignedR2Url } from '../../exports/signed-url.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

function printSecretOf(env: WorkerEnv): string {
  return env.PRINT_TOKEN_SECRET ?? env.JWT_SIGNING_KEY;
}

function exportsBucketName(env: WorkerEnv): string {
  if (env.R2_EXPORTS_BUCKET_NAME) return env.R2_EXPORTS_BUCKET_NAME;
  return env.ENV === 'production' ? 'mbfd-bid-exports-production' : 'mbfd-bid-exports-staging';
}

function signerOf(env: WorkerEnv): ((key: string) => Promise<string>) | null {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID) return null;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const accountId = env.R2_ACCOUNT_ID;
  const bucket = exportsBucketName(env);
  return (key) =>
    createSignedR2Url({
      bucket,
      key,
      accessKeyId,
      secretAccessKey,
      accountId,
      ttlSec: 3600,
      now: () => new Date(),
    });
}

const PrintTokenBody = z.object({
  kind: z.enum(['roster', 'audit-csv']),
  shift: z.enum(['A', 'B', 'C', 'D']).optional(),
  session_id: z.string().min(1),
});

router.post('/print-token', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = PrintTokenBody.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  // Strip `undefined` shift so exactOptionalPropertyTypes is happy.
  const claims =
    parsed.data.shift === undefined
      ? { kind: parsed.data.kind, session_id: parsed.data.session_id }
      : {
          kind: parsed.data.kind,
          shift: parsed.data.shift,
          session_id: parsed.data.session_id,
        };
  const token = mintPrintToken(claims, printSecretOf(c.env));
  return c.json({ token });
});

router.post('/roster/:shift', requireStepUpAuth(), async (c) => {
  const shift = c.req.param('shift');
  if (!shift || !['A', 'B', 'C', 'D'].includes(shift)) {
    return c.json({ error: 'invalid_shift', shift }, 400);
  }
  if (!c.env.BROWSERLESS_TOKEN) {
    return c.json({ error: 'browserless_not_configured' }, 503);
  }
  if (!c.env.R2_EXPORTS || typeof c.env.R2_EXPORTS.put !== 'function') {
    return c.json({ error: 'exports_bucket_not_configured' }, 503);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = z.object({ session_id: z.string().min(1) }).safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  try {
    const out = await generateRosterPdf({
      shift: shift as 'A' | 'B' | 'C' | 'D',
      sessionId: parsed.data.session_id,
      year: new Date().getUTCFullYear(),
      browserlessToken: c.env.BROWSERLESS_TOKEN,
      printTokenSecret: printSecretOf(c.env),
      webBaseUrl: c.env.WEB_BASE_URL ?? 'https://staging.bid.mbfdhub.com',
      r2: c.env.R2_EXPORTS,
      fetchImpl: fetch,
      now: () => Date.now(),
    });
    return c.json(out);
  } catch (err) {
    return c.json({ error: 'roster_pdf_failed', message: (err as Error).message }, 502);
  }
});

router.post('/audit-csv', requireStepUpAuth(), async (c) => {
  if (!c.env.R2_EXPORTS || typeof c.env.R2_EXPORTS.put !== 'function') {
    return c.json({ error: 'exports_bucket_not_configured' }, 503);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = z.object({ session_id: z.string().min(1) }).safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const signer = signerOf(c.env);
  const signUrl = signer ?? (async (key: string) => `r2://${exportsBucketName(c.env)}/${key}`);
  try {
    const out = await exportAuditCsv({
      bidSessionId: parsed.data.session_id,
      year: new Date().getUTCFullYear(),
      db: auditCsvDbFromD1(c.env.DB, parsed.data.session_id),
      r2: c.env.R2_EXPORTS,
      signUrl,
      now: () => Date.now(),
    });
    return c.json(out);
  } catch (err) {
    return c.json({ error: 'audit_csv_failed', message: (err as Error).message }, 500);
  }
});

router.get('/:session_id', async (c) => {
  const sid = c.req.param('session_id');
  const year = new Date().getUTCFullYear();
  if (!c.env.R2_EXPORTS || typeof c.env.R2_EXPORTS.list !== 'function') {
    return c.json({ exports: [] });
  }
  const list = await c.env.R2_EXPORTS.list({ prefix: `${year}/${sid}/` });
  const exports = list.objects.map((o) => ({
    r2Key: o.key,
    kind: o.key.endsWith('.pdf') ? 'roster-pdf' : o.key.endsWith('.csv.gz') ? 'audit-csv' : 'other',
    bytes: o.size,
    uploadedAt: o.uploaded.toISOString(),
  }));
  return c.json({ exports });
});

router.get('/:session_id/:r2key/url', async (c) => {
  const signer = signerOf(c.env);
  if (!signer) return c.json({ error: 'signed_urls_not_configured' }, 503);
  const key = decodeURIComponent(c.req.param('r2key'));
  const url = await signer(key);
  return c.json({ url });
});

export default router;

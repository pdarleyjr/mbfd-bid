// Plan 08 Task 17 — Admin export trigger + list endpoints.
//
// Endpoints:
//   POST /print-token             Mint a 5-min HMAC token for Browserless
//   POST /roster/:shift           Generate + upload roster PDF for shift
//   POST /audit-csv               Stream audit_log → gzip → R2 + return signed URL
//   GET  /roster-data             (W35) Print-token auth, no admin JWT — used by
//                                  Browserless to render the roster RSC page
//   GET  /:session_id             List exports for a session (R2 listing)
//
// Write endpoints require step-up auth (Plan 05 `requireStepUpAuth`).
// `/roster-data` is intentionally UNAUTHENTICATED via admin JWT because
// Browserless cannot carry one; authorization comes from the HMAC
// print-token bound to {kind, shift, session_id, exp}.

import type { JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDb } from '../../db/index.js';
import { bids, members, positions } from '../../db/schema.js';
import { auditCsvDbFromD1 } from '../../exports/audit-csv-db.js';
import { exportAuditCsv } from '../../exports/audit-csv.js';
import { mintPrintToken, verifyPrintToken } from '../../exports/print-token.js';
import { generateRosterPdf } from '../../exports/roster-pdf.js';
import { createSignedR2Url } from '../../exports/signed-url.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();

// W35 — Print-token-authorized roster-data endpoint. MUST be declared
// BEFORE `router.use('*', requireAdmin)` so the admin-JWT guard is bypassed.
// Authorization is the HMAC print-token bound to {kind=roster, shift,
// session_id, exp}.
const RosterShiftSchema = z.enum(['A', 'B', 'C', 'D']);
router.get('/roster-data', async (c) => {
  const sessionId = c.req.query('session_id');
  const shiftRaw = c.req.query('shift');
  const token = c.req.query('token');
  if (!sessionId || !shiftRaw || !token) {
    return c.json({ error: 'missing_query', required: ['session_id', 'shift', 'token'] }, 400);
  }
  const shiftParsed = RosterShiftSchema.safeParse(shiftRaw);
  if (!shiftParsed.success) {
    return c.json({ error: 'invalid_shift', shift: shiftRaw }, 400);
  }
  const shift = shiftParsed.data;
  const secret = c.env.PRINT_TOKEN_SECRET ?? c.env.JWT_SIGNING_KEY;
  const ok = verifyPrintToken(token, secret, {
    kind: 'roster',
    shift,
    session_id: sessionId,
  });
  if (!ok) {
    return c.json({ error: 'invalid_print_token' }, 401);
  }

  const db = getDb(c.env.DB);
  // Load all positions on this shift (joined to bids if a member picked them).
  const allPositions = await db.select().from(positions).where(eq(positions.shift, shift)).all();
  const allBids = await db.select().from(bids).where(eq(bids.bidSessionId, sessionId)).all();
  const bidByPosition = new Map<string, (typeof allBids)[number]>();
  for (const b of allBids) bidByPosition.set(b.positionId, b);

  // Load members for resolved bids in one batch.
  const memberIds = [...new Set(allBids.map((b) => b.memberId))];
  const memberRows = memberIds.length
    ? await Promise.all(
        memberIds.map((id) => db.select().from(members).where(eq(members.id, id)).get()),
      )
    : [];
  const memberById = new Map<number, NonNullable<(typeof memberRows)[number]>>();
  for (const m of memberRows) {
    if (m) memberById.set(m.id, m);
  }

  // Group by station.
  const stationMap = new Map<
    string,
    Array<{
      position_id: string;
      unit: string;
      rank: string;
      member_name: string | null;
      rsc_seniority: number | null;
    }>
  >();
  const flatMembers: Array<{
    memberId: number;
    employeeId: string;
    name: string;
    rank: string;
    positionId: string;
    station: string;
    unit: string;
  }> = [];

  for (const p of allPositions) {
    const bid = bidByPosition.get(p.id);
    const member = bid ? memberById.get(bid.memberId) : null;
    const memberName = member ? `${member.firstName} ${member.lastName}` : null;
    const rscSeniority = member ? member.rscSeniority : null;
    const row = {
      position_id: p.id,
      unit: p.unit,
      rank: p.rankRequired,
      member_name: memberName,
      rsc_seniority: rscSeniority,
    };
    const existing = stationMap.get(p.station);
    if (existing) {
      existing.push(row);
    } else {
      stationMap.set(p.station, [row]);
    }
    if (member && bid) {
      flatMembers.push({
        memberId: member.id,
        employeeId: member.employeeId,
        name: memberName ?? '',
        rank: member.rank,
        positionId: bid.positionId,
        station: p.station,
        unit: p.unit,
      });
    }
  }

  const stations = [...stationMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([station, rows]) => ({
      station,
      rows: rows.sort((a, b) => a.position_id.localeCompare(b.position_id)),
    }));

  return c.json({
    year: new Date().getUTCFullYear(),
    shift,
    station_count: stations.length,
    position_count: allPositions.length,
    stations,
    // W35 spec — flat members array for direct consumers that don't need
    // the station-grouped print layout.
    members: flatMembers,
    generatedAt: new Date().toISOString(),
  });
});

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

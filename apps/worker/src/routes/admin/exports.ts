// Plan 08 Task 17 — Admin export trigger + list endpoints.
//
// Endpoints:
//   POST /print-token             Mint a 5-min HMAC token for the headless
//                                  browser's render request
//   POST /roster/:shift           Generate + upload roster PDF for shift
//   POST /audit-csv               Stream audit_log → gzip → R2 + return signed URL
//   GET  /roster-data             (W35) Print-token auth, no admin JWT — used by
//                                  the headless browser to render the roster RSC page
//   GET  /:session_id             List exports for a session (R2 listing)
//
// Write endpoints require step-up auth (Plan 05 `requireStepUpAuth`).
// `/roster-data` is intentionally UNAUTHENTICATED via admin JWT because
// the headless browser cannot carry one; authorization comes from the HMAC
// print-token bound to {kind, shift, session_id, exp}.
//
// 2026-05 swap: roster PDF rendering moved from the Browserless v2 HTTP API
// to the Cloudflare Browser Rendering binding (`env.BROWSER` +
// `@cloudflare/puppeteer`). No external token is required on the Workers
// Paid plan.

import type { JwtPayload } from '@mbfd/shared';
import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { loadCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { bidSessions, bids, canonicalBidSessionState } from '../../db/schema.js';
import { auditCsvDbFromD1 } from '../../exports/audit-csv-db.js';
import { exportAuditCsv } from '../../exports/audit-csv.js';
import { mintPrintToken, verifyPrintToken } from '../../exports/print-token.js';
import { generateRosterPdf } from '../../exports/roster-pdf.js';
import { generateShiftPdf } from '../../exports/shift-roster-pdf.js';
import { generateShiftWorkbook } from '../../exports/shift-roster-xlsx.js';
import { ShiftRosterError, captureShiftRoster } from '../../exports/shift-roster.js';
import { generateShiftViewPdf } from '../../exports/shift-view-pdf.js';
import { generateShiftViewWorkbook } from '../../exports/shift-view-xlsx.js';
import { createSignedR2Url } from '../../exports/signed-url.js';
import { auditInsertStatement } from '../../lib/audit.js';
import { loadFrozenSessionBidPolicy } from '../../lib/bid-policy.js';
import { createCsvStream } from '../../lib/csv-stream.js';
import { loadCurrentStaffingReceipt } from '../../lib/current-staffing-source.js';
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
  // An established session is rendered solely from its materialized V3 policy
  // source. Calling current `members` or `positions` here would allow a later
  // roster/template correction to rewrite a previously captured export.
  const frozen = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozen.ok || frozen.snapshot.v !== 3) {
    return c.json(
      { error: frozen.ok ? 'session_policy_snapshot_material_missing' : frozen.code },
      409,
    );
  }

  const session = await db
    .select({ bidYear: bidSessions.bidYear, isMock: bidSessions.isMock })
    .from(bidSessions)
    .where(eq(bidSessions.id, sessionId))
    .get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);

  let canonical: Awaited<ReturnType<typeof loadCanonicalBidSessionState>>;
  try {
    canonical = await loadCanonicalBidSessionState(c.env.DB, sessionId);
  } catch {
    return c.json({ error: 'canonical_state_invalid' }, 409);
  }
  // Canonical commands do not write legacy `bids` rows. Even an empty fills
  // object is authoritative; legacy rows are only for pre-canonical sessions.
  const awards =
    canonical === null
      ? await db
          .select({ memberId: bids.memberId, positionId: bids.positionId })
          .from(bids)
          .where(eq(bids.bidSessionId, sessionId))
          .all()
      : Object.entries(canonical.fills).map(([positionId, fill]) => ({
          memberId: fill.memberId,
          positionId,
        }));

  const snapshot = frozen.snapshot;
  const positionById = new Map(
    snapshot.ruleBookMaterial.positions.map((position) => [position.id, position]),
  );
  const memberById = new Map(snapshot.members.map((member) => [member.memberId, member]));
  const validBiddablePositionIds = new Set(frozen.coverage.validRulePositionIds);
  // Deliberately avoid exposing a canonical row ID or employee identifier. A
  // deterministic, session-scoped ordinal is enough for the print roster.
  const pseudonymByMemberId = new Map(
    [...snapshot.members]
      .sort((a, b) => a.memberId - b.memberId)
      .map((member, index) => [member.memberId, `M-${String(index + 1).padStart(3, '0')}`]),
  );
  const bidByPosition = new Map<string, (typeof awards)[number]>();
  for (const bid of awards) {
    // Bid records are session history, but every reference must still resolve
    // inside the immutable material before the export can be trusted.
    const frozenPosition = positionById.get(bid.positionId);
    const frozenMember = memberById.get(bid.memberId);
    if (
      frozenPosition === undefined ||
      frozenMember === undefined ||
      frozenMember.pool === 'EXCLUDED' ||
      frozenPosition.bidParticipation !== 'BIDDABLE' ||
      !validBiddablePositionIds.has(bid.positionId) ||
      bidByPosition.has(bid.positionId)
    ) {
      return c.json({ error: 'session_bid_reference_invalid' }, 409);
    }
    bidByPosition.set(bid.positionId, bid);
  }

  const snapshotPositions = snapshot.ruleBookMaterial.positions.filter(
    (position) => position.shift === shift,
  );

  // Group by station.
  const stationMap = new Map<
    string,
    Array<{
      position_id: string;
      position_name: string;
      unit: string;
      rank: string;
      member_id: string | null;
      member_name: string | null;
      member_rank: string | null;
      a_day: string | null;
      rsc_seniority: number | null;
    }>
  >();
  const flatMembers: Array<{
    memberId: string;
    rank: string;
    positionId: string;
    station: string;
    unit: string;
  }> = [];

  for (const p of snapshotPositions) {
    const bid = bidByPosition.get(p.id);
    const member = bid ? memberById.get(bid.memberId) : null;
    const memberId = member ? (pseudonymByMemberId.get(member.memberId) ?? null) : null;
    // `member_name` remains for the existing render page's stable payload
    // contract, but is a synthetic label rather than copied roster identity.
    const memberName = memberId === null ? null : `Member ${memberId}`;
    const rscSeniority = member ? member.rscSeniority : null;
    const row = {
      position_id: p.id,
      position_name: p.positionName,
      unit: p.unit,
      rank: p.rankRequired,
      member_id: memberId,
      member_name: memberName,
      member_rank: member?.rank ?? null,
      a_day:
        bid && canonical
          ? (canonical.aDay?.picks.find((pick) => pick.memberId === bid.memberId)?.aDay ??
            canonical.fills[p.id]?.aDay ??
            null)
          : null,
      rsc_seniority: rscSeniority,
    };
    const existing = stationMap.get(p.station);
    if (existing) {
      existing.push(row);
    } else {
      stationMap.set(p.station, [row]);
    }
    if (member && bid && memberId !== null) {
      flatMembers.push({
        memberId,
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
    year: session.bidYear,
    shift,
    is_mock: session.isMock,
    session_id: sessionId,
    canonical_sequence: canonical?.lastSeq ?? null,
    award_count: flatMembers.length,
    station_count: stations.length,
    position_count: snapshotPositions.length,
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
  return env.ENV === 'production' ? 'mbfd-bid-exports-production' : 'mbfd-bid-test-exports';
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

function exportKeyMatchesSession(sessionId: string, key: string): boolean {
  const [year, owner, filename, ...nested] = key.split('/');
  return (
    /^\d{4}$/.test(year ?? '') &&
    owner === sessionId &&
    filename !== undefined &&
    filename.length > 0 &&
    filename !== '.' &&
    filename !== '..' &&
    nested.length === 0
  );
}

async function exportKeyBelongsToSession(env: WorkerEnv, sessionId: string, key: string) {
  if (!exportKeyMatchesSession(sessionId, key)) return false;
  if (!env.R2_EXPORTS || typeof env.R2_EXPORTS.head !== 'function') return false;
  const object = await env.R2_EXPORTS.head(key).catch(() => null);
  return object !== null;
}

/** The storage partition is the generation year, not necessarily the Bid year.
 * Enumerate only root year prefixes, then list this session inside each year.
 * Saved immutable exports remain visible after New Year. */
async function listSessionExportObjects(bucket: WorkerEnv['R2_EXPORTS'], sessionId: string) {
  const years = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ delimiter: '/', ...(cursor ? { cursor } : {}) });
    for (const prefix of page.delimitedPrefixes ?? []) {
      if (/^\d{4}\/$/.test(prefix)) years.add(prefix);
    }
    // Includes root-list adapters which return objects instead of delimiters.
    for (const object of page.objects) {
      const year = object.key.split('/')[0];
      if (/^\d{4}$/.test(year ?? '')) years.add(`${year}/`);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const objects = new Map<string, Awaited<ReturnType<typeof bucket.list>>['objects'][number]>();
  for (const year of years) {
    cursor = undefined;
    do {
      const page = await bucket.list({
        prefix: `${year}${sessionId}/`,
        ...(cursor ? { cursor } : {}),
      });
      for (const object of page.objects) {
        if (exportKeyMatchesSession(sessionId, object.key)) objects.set(object.key, object);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return [...objects.values()].sort(
    (a, b) => b.uploaded.getTime() - a.uploaded.getTime() || a.key.localeCompare(b.key),
  );
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
  if (!c.env.BROWSER || typeof (c.env.BROWSER as { fetch?: unknown }).fetch !== 'function') {
    return c.json({ error: 'browser_rendering_not_configured' }, 503);
  }
  if (!c.env.R2_EXPORTS || typeof c.env.R2_EXPORTS.put !== 'function') {
    return c.json({ error: 'exports_bucket_not_configured' }, 503);
  }
  const webBaseUrl = c.env.WEB_BASE_URL;
  if (!webBaseUrl) return c.json({ error: 'web_base_not_configured' }, 503);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = z.object({ session_id: z.string().min(1) }).safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  try {
    const claims = c.get('claims');
    await c.env.DB.batch([
      auditInsertStatement(c.env.DB, {
        bidSessionId: parsed.data.session_id,
        actorType: 'admin',
        actorId: claims.member_id,
        action: 'export_generate',
        targetKind: 'roster_pdf',
        targetId: `${parsed.data.session_id}:${shift}`,
        afterState: { export_type: 'roster_pdf', shift },
        reason: 'Administrator requested roster PDF generation.',
      }),
    ]);
    const out = await generateRosterPdf({
      shift: shift as 'A' | 'B' | 'C' | 'D',
      sessionId: parsed.data.session_id,
      year: new Date().getUTCFullYear(),
      browser: c.env.BROWSER,
      printTokenSecret: printSecretOf(c.env),
      webBaseUrl,
      r2: c.env.R2_EXPORTS,
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
    const claims = c.get('claims');
    await c.env.DB.batch([
      auditInsertStatement(c.env.DB, {
        bidSessionId: parsed.data.session_id,
        actorType: 'admin',
        actorId: claims.member_id,
        action: 'export_generate',
        targetKind: 'audit_csv',
        targetId: parsed.data.session_id,
        afterState: { export_type: 'audit_csv' },
        reason: 'Administrator requested immutable audit CSV export.',
      }),
    ]);
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

/**
 * A direct, immutable-policy progress download deliberately avoids the R2
 * rendering path. Operators can obtain it mid-Bid even when the optional
 * Browser Rendering/R2 export services are unavailable.
 */
router.get('/:session_id/progress.csv', async (c) => {
  const sessionId = c.req.param('session_id');
  const db = getDb(c.env.DB);
  const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);

  const frozen = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozen.ok || frozen.snapshot.v !== 3) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: !frozen.ok ? frozen.code : 'session_policy_snapshot_material_missing',
      },
      409,
    );
  }

  let canonical: Awaited<ReturnType<typeof loadCanonicalBidSessionState>>;
  try {
    canonical = await loadCanonicalBidSessionState(c.env.DB, sessionId);
  } catch {
    return c.json({ error: 'canonical_state_invalid' }, 409);
  }
  const [canonicalRow, awards] = await Promise.all([
    db
      .select({ lastCommandId: canonicalBidSessionState.lastCommandId })
      .from(canonicalBidSessionState)
      .where(eq(canonicalBidSessionState.bidSessionId, sessionId))
      .get(),
    db.select({ count: count() }).from(bids).where(eq(bids.bidSessionId, sessionId)).get(),
  ]);

  const row = {
    exportKind: 'bid_progress',
    bidSessionId: sessionId,
    bidYear: session.bidYear,
    isMock: session.isMock,
    bidState: canonical?.currentPhase ?? session.currentPhase,
    configurationRevision: frozen.snapshot.configurationRevision,
    ruleBookVersion: frozen.snapshot.ruleBookVersion,
    ruleBookRevision: frozen.snapshot.ruleBookRevision,
    positionTemplateVersion: frozen.snapshot.positionTemplateVersion,
    rosterSnapshotAt: new Date(frozen.snapshot.capturedAtMs).toISOString(),
    lastCommittedCommandId: canonicalRow?.lastCommandId ?? null,
    lastCommittedCommandSequence: canonical?.lastSeq ?? 0,
    awardsCommitted:
      canonical === null ? (awards?.count ?? 0) : Object.keys(canonical.fills).length,
    exportedAt: new Date().toISOString(),
  };

  async function* rows() {
    yield row;
  }

  const safeSessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
  return new Response(
    createCsvStream(rows(), [
      { header: 'export_kind', value: (value) => value.exportKind },
      { header: 'bid_session_id', value: (value) => value.bidSessionId },
      { header: 'bid_year', value: (value) => value.bidYear },
      { header: 'is_mock', value: (value) => value.isMock },
      { header: 'bid_state', value: (value) => value.bidState },
      { header: 'configuration_revision', value: (value) => value.configurationRevision },
      { header: 'rule_book_version', value: (value) => value.ruleBookVersion },
      { header: 'rule_book_revision', value: (value) => value.ruleBookRevision },
      { header: 'position_template_version', value: (value) => value.positionTemplateVersion },
      { header: 'roster_snapshot_at', value: (value) => value.rosterSnapshotAt },
      { header: 'last_committed_command_id', value: (value) => value.lastCommittedCommandId },
      {
        header: 'last_committed_command_sequence',
        value: (value) => value.lastCommittedCommandSequence,
      },
      { header: 'awards_committed', value: (value) => value.awardsCommitted },
      { header: 'exported_at', value: (value) => value.exportedAt },
    ]),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mbfd-bid-progress-${safeSessionId}.csv"`,
        'Cache-Control': 'no-store',
      },
    },
  );
});

/** Direct read-only shift downloads are available in every phase. Unlike the
 * historical captured R2 exports, these capture current canonical progress and
 * never write an audit event, command, award, or session state. */
router.get('/:session_id/shifts', async (c) => {
  const selection = z
    .object({
      format: z.enum(['pdf', 'xlsx']),
      shift: z.enum(['A', 'B', 'C', 'D', 'ALL']),
      view: z.enum(['bid', 'shift']),
    })
    .safeParse({
      format: c.req.query('format'),
      shift: c.req.query('shift') ?? 'ALL',
      view: c.req.query('view') ?? 'bid',
    });
  if (!selection.success) return c.json({ error: 'invalid_export_selection' }, 400);
  if (
    selection.data.format === 'pdf' &&
    (!c.env.BROWSER || typeof (c.env.BROWSER as { fetch?: unknown }).fetch !== 'function')
  ) {
    return c.json({ error: 'browser_rendering_not_configured' }, 503);
  }
  try {
    const roster = await captureShiftRoster(
      c.env.DB,
      c.req.param('session_id'),
      selection.data.shift,
      selection.data.view === 'shift' ? await loadCurrentStaffingReceipt(c.env.R2_EXPORTS) : null,
    );
    const body =
      selection.data.format === 'xlsx'
        ? await (
            await (selection.data.view === 'shift'
              ? generateShiftViewWorkbook(roster)
              : generateShiftWorkbook(roster))
          ).arrayBuffer()
        : await (selection.data.view === 'shift'
            ? generateShiftViewPdf(roster, c.env.BROWSER)
            : generateShiftPdf(roster, c.env.BROWSER));
    const viewName = selection.data.view === 'shift' ? '-shift-view' : '';
    const fileName = `mbfd-${roster.isMock ? 'mock' : 'real'}-bid-${roster.year}-${roster.scope}${viewName}-seq-${roster.sequence}.${selection.data.format}`;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type':
          selection.data.format === 'xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-MBFD-Bid-Sequence': String(roster.sequence),
      },
    });
  } catch (error) {
    if (error instanceof ShiftRosterError) return c.json({ error: error.code }, error.status);
    return c.json({ error: 'shift_export_failed' }, 502);
  }
});

router.get('/:session_id', async (c) => {
  const sid = c.req.param('session_id');
  if (!c.env.R2_EXPORTS || typeof c.env.R2_EXPORTS.list !== 'function') {
    return c.json({ exports: [] });
  }
  const objects = await listSessionExportObjects(c.env.R2_EXPORTS, sid);
  const exports = objects.map((o) => ({
    r2Key: o.key,
    kind: o.key.endsWith('.pdf') ? 'roster-pdf' : o.key.endsWith('.csv.gz') ? 'audit-csv' : 'other',
    bytes: o.size,
    uploadedAt: o.uploaded.toISOString(),
  }));
  return c.json({ exports });
});

router.get('/:session_id/:r2key/url', async (c) => {
  const sid = c.req.param('session_id');
  const key = decodeURIComponent(c.req.param('r2key'));
  const belongs = await exportKeyBelongsToSession(c.env, sid, key);
  if (!belongs) return c.json({ error: 'export_not_found' }, 404);
  const signer = signerOf(c.env);
  if (!signer) {
    return c.json({
      url: `/api/admin/exports/${encodeURIComponent(sid)}/${encodeURIComponent(key)}/download`,
    });
  }
  const url = await signer(key);
  return c.json({ url });
});

router.get('/:session_id/:r2key/download', async (c) => {
  const sid = c.req.param('session_id');
  const key = decodeURIComponent(c.req.param('r2key'));
  const belongs = await exportKeyBelongsToSession(c.env, sid, key);
  if (!belongs) return c.json({ error: 'export_not_found' }, 404);
  if (!c.env.R2_EXPORTS || typeof c.env.R2_EXPORTS.get !== 'function') {
    return c.json({ error: 'exports_bucket_not_configured' }, 503);
  }
  const object = await c.env.R2_EXPORTS.get(key);
  if (object === null) return c.json({ error: 'export_not_found' }, 404);

  const rawFileName = key.split('/').pop() ?? 'mbfd-bid-export';
  const fileName = rawFileName.replace(/[^A-Za-z0-9._-]/g, '_');
  const contentType = fileName.endsWith('.pdf')
    ? 'application/pdf'
    : fileName.endsWith('.csv.gz')
      ? 'application/gzip'
      : 'application/octet-stream';
  const bytes = await object.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(object.size),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

export default router;

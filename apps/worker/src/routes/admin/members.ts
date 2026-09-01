import type { JwtPayload } from '@mbfd/shared';
import { type SQL, and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import {
  bidSessions,
  credentials as credentialsTable,
  manualBidOrderOverride,
  memberCredentials,
  members,
} from '../../db/schema.js';
import { auditInsertStatement, writeAuditLog } from '../../lib/audit.js';
import { computeBidOrder } from '../../lib/bid-order.js';
import { chunkedInArraySelect } from '../../lib/d1-batch.js';
import {
  STATIONS,
  type Station,
  isEligibleFor,
  stationRuleText,
  stationTitle,
} from '../../lib/station-eligibility.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

type RetiredLegacyMemberWriteOperation =
  | 'member_import'
  | 'member_patch'
  | 'credential_change'
  | 'synthesis_seed';

const RETIRED_LEGACY_MEMBER_WRITE_WORKFLOWS = {
  personnel: {
    ui: '/admin/personnel',
    api: '/api/admin/personnel/changes',
  },
  telestaff: {
    ui: '/admin/telestaff',
    api: '/api/admin/telestaff/imports',
  },
} as const;

const RETIRED_LEGACY_MEMBER_WRITE_OPERATIONS: ReadonlySet<RetiredLegacyMemberWriteOperation> =
  new Set(['member_import', 'member_patch', 'credential_change', 'synthesis_seed']);

/**
 * Legacy member writes cannot produce the effective-dated, idempotent, immutable
 * evidence now required for current-member projections. They are intentionally
 * retired instead of accepting a partial audit record.
 */
function retiredLegacyMemberWrite(
  c: Context<AdminEnv>,
  operation: RetiredLegacyMemberWriteOperation,
) {
  return c.json(
    {
      error: 'legacy_member_write_retired',
      operation,
      message:
        'This legacy member write endpoint is retired. It does not mutate the current member projection or create audit evidence.',
      operator_workflows: RETIRED_LEGACY_MEMBER_WRITE_WORKFLOWS,
      ...(operation === 'credential_change'
        ? {
            credential_lifecycle: {
              status: 'configured',
              api: '/api/admin/qualification-lifecycle/events',
              history_api: '/api/admin/qualification-lifecycle/members/:memberId',
              message:
                'Direct credential toggles remain retired. Use the effective-dated qualification evidence workflow instead.',
            },
          }
        : {}),
    },
    410,
  );
}

/**
 * Roster row shape — what the Members Master Roster table consumes.
 * `rankSeniority` is intentionally `number | null` (fractional values
 * preserved as-is for cases like Mederos at 74.5).
 */
export interface RosterRow {
  id: number;
  employee_id: string;
  last_name: string;
  first_name: string;
  rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
  bid_category: 'OFC' | 'FF' | 'EXCLUDED';
  rsc_seniority: number;
  rank_seniority: number | null;
  ordinal: number;
  manual_override_ordinal: number | null;
  credential_ids: number[];
}

/**
 * Notes attached to credentials by `credentials_master.json`. The DB
 * `credentials` table does not have a notes column, so the worker carries
 * the canonical text inline. Surface these in tooltips on the toggle UI.
 */
export const CREDENTIAL_NOTES: Readonly<Record<string, string>> = {
  'Basic Life Support (BLS) INSTRUCTOR AHA': 'For Capt 5: Either/Or',
  'Fire Investigator (FL cert issued 2015 or later)': 'Investigator: Count 1 max',
  'Firesafety Inspector I': 'Count 1 max',
  'Instructor I': 'Count 1 max',
  'Pediatric Advanced Life Support (PALS) INSTRUCTOR AHA': 'Count 1 max',
};

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

router.post('/import', requireStepUpAuth(), (c) => retiredLegacyMemberWrite(c, 'member_import'));

router.get('/', async (c) => {
  const limitParam = c.req.query('limit');
  const offsetParam = c.req.query('offset');
  const bidCategory = c.req.query('bid_category');
  const rank = c.req.query('rank');

  const limit = Math.min(500, Math.max(1, Number(limitParam ?? 100)));
  const offset = Math.max(0, Number(offsetParam ?? 0));

  const db = getDb(c.env.DB);

  const filters: SQL[] = [];
  if (bidCategory) {
    filters.push(eq(members.bidCategory, bidCategory as 'OFC' | 'FF' | 'EXCLUDED'));
  }
  if (rank) {
    filters.push(eq(members.rank, rank as 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF'));
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const list = await db.select().from(members).where(where).limit(limit).offset(offset).all();

  const totalRow = await db.select({ n: sql<number>`count(*)` }).from(members).where(where).get();

  return c.json({ members: list, total: totalRow?.n ?? 0 });
});

router.get('/:id{\\d+}', async (c) => {
  const idParam = c.req.param('id');
  const id = Number(idParam);

  const db = getDb(c.env.DB);
  const member = await db.select().from(members).where(eq(members.id, id)).get();

  if (member === undefined) {
    return c.json({ error: 'not_found' }, 404);
  }

  const creds = await db
    .select({ id: credentialsTable.id, name: credentialsTable.name })
    .from(memberCredentials)
    .innerJoin(credentialsTable, eq(memberCredentials.credentialId, credentialsTable.id))
    .where(eq(memberCredentials.memberId, id))
    .all();

  return c.json({ member, credentials: creds });
});

// PATCH /api/admin/members/:id is retained only as an explicit retirement response.
router.patch('/:id{\\d+}', requireStepUpAuth(), (c) => retiredLegacyMemberWrite(c, 'member_patch'));

// ── Members section / Master Roster — Task A5 ─────────────────────────────
//
// Helpers shared by /roster, /eligible-for/:station, and other read paths.

interface RawMemberRow {
  id: number;
  employee_id: string;
  last_name: string;
  first_name: string;
  rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
  bid_category: 'OFC' | 'FF' | 'EXCLUDED';
  rsc_seniority: number;
  rank_seniority: number | null;
}

/**
 * Loads members + their credential names/ids, computes natural bid order,
 * then applies optional manual_bid_order_override rows for a given session.
 * Returns rows sorted ascending by ordinal.
 */
async function loadRoster(
  db: ReturnType<typeof getDb>,
  opts: {
    rank: string | undefined;
    sessionId: string | undefined;
    search: string | undefined;
    station: Station | undefined;
  },
): Promise<RosterRow[]> {
  const filters: SQL[] = [];
  if (opts.rank) {
    filters.push(eq(members.rank, opts.rank as RawMemberRow['rank']));
  }
  if (opts.search && opts.search.trim().length > 0) {
    const needle = `%${opts.search.trim()}%`;
    const searchOr = or(
      like(members.lastName, needle),
      like(members.firstName, needle),
      like(members.employeeId, needle),
    );
    if (searchOr !== undefined) filters.push(searchOr);
  }
  const where = filters.length > 0 ? and(...filters) : undefined;

  const memberRows = await db
    .select({
      id: members.id,
      employeeId: members.employeeId,
      firstName: members.firstName,
      lastName: members.lastName,
      rank: members.rank,
      bidCategory: members.bidCategory,
      rscSeniority: members.rscSeniority,
      rankSeniority: members.rankSeniority,
    })
    .from(members)
    .where(where)
    .all();

  if (memberRows.length === 0) return [];

  const ids = memberRows.map((m) => m.id);
  // Chunk the IN-list — D1 caps bound parameters at ~100 per statement.
  const credsRows = await chunkedInArraySelect(ids, (chunk) =>
    db
      .select({
        memberId: memberCredentials.memberId,
        credentialId: memberCredentials.credentialId,
        credentialName: credentialsTable.name,
      })
      .from(memberCredentials)
      .innerJoin(credentialsTable, eq(memberCredentials.credentialId, credentialsTable.id))
      .where(inArray(memberCredentials.memberId, chunk))
      .all(),
  );

  const credIdsByMember = new Map<number, number[]>();
  const credNamesByMember = new Map<number, string[]>();
  for (const row of credsRows) {
    const ids2 = credIdsByMember.get(row.memberId) ?? [];
    ids2.push(row.credentialId);
    credIdsByMember.set(row.memberId, ids2);
    const names = credNamesByMember.get(row.memberId) ?? [];
    names.push(row.credentialName);
    credNamesByMember.set(row.memberId, names);
  }

  // Compute natural bid order across the FULL member set (not filtered),
  // so ordinals stay stable when filters narrow the result.
  const allMembers = await db
    .select({
      id: members.id,
      bidCategory: members.bidCategory,
      rscSeniority: members.rscSeniority,
      rankSeniority: members.rankSeniority,
    })
    .from(members)
    .all();
  const ordered = computeBidOrder(
    allMembers.map((m) => ({
      id: m.id,
      bidCategory: m.bidCategory,
      rscSeniority: m.rscSeniority,
      rankSeniority: m.rankSeniority,
    })),
  );
  const ordinalByMember = new Map<number, number>();
  for (const o of ordered) ordinalByMember.set(o.memberId, o.ordinal);

  // Apply manual overrides if a session id is provided.
  const overrideByMember = new Map<number, number>();
  if (opts.sessionId) {
    const overrides = await db
      .select({
        memberId: manualBidOrderOverride.memberId,
        overrideOrdinal: manualBidOrderOverride.overrideOrdinal,
      })
      .from(manualBidOrderOverride)
      .where(eq(manualBidOrderOverride.bidSessionId, opts.sessionId))
      .all();
    for (const o of overrides) overrideByMember.set(o.memberId, o.overrideOrdinal);
  }

  let rows: RosterRow[] = memberRows.map((m) => {
    const naturalOrdinal = ordinalByMember.get(m.id) ?? Number.MAX_SAFE_INTEGER;
    const overrideOrdinal = overrideByMember.get(m.id) ?? null;
    return {
      id: m.id,
      employee_id: m.employeeId,
      last_name: m.lastName,
      first_name: m.firstName,
      rank: m.rank,
      bid_category: m.bidCategory,
      rsc_seniority: m.rscSeniority,
      rank_seniority: m.rankSeniority,
      ordinal: overrideOrdinal ?? naturalOrdinal,
      manual_override_ordinal: overrideOrdinal,
      credential_ids: credIdsByMember.get(m.id) ?? [],
    };
  });

  if (opts.station) {
    const station = opts.station;
    rows = rows.filter((r) =>
      isEligibleFor(station, {
        rank: r.rank,
        credentialNames: credNamesByMember.get(r.id) ?? [],
        employeeId: r.employee_id,
      }),
    );
  }

  rows.sort((a, b) => a.ordinal - b.ordinal);
  return rows;
}

router.get('/roster', async (c) => {
  try {
    const rank = c.req.query('rank');
    const sessionId = c.req.query('session_id');
    const search = c.req.query('search');
    const stationParam = c.req.query('station');
    let station: Station | undefined;
    if (stationParam) {
      if (!STATIONS.includes(stationParam as Station)) {
        return c.json({ error: 'invalid_station', stations: STATIONS }, 400);
      }
      station = stationParam as Station;
    }

    const db = getDb(c.env.DB);
    const rows = await loadRoster(db, { rank, sessionId, search, station });
    return c.json({ members: rows, total: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[roster-error]', { msg, stack });
    return c.json({ error: 'roster_load_failed', detail: msg }, 500);
  }
});

router.get('/eligible-for/:station', async (c) => {
  try {
    const stationParam = c.req.param('station');
    if (!STATIONS.includes(stationParam as Station)) {
      return c.json({ error: 'invalid_station', stations: STATIONS }, 400);
    }
    const station = stationParam as Station;
    const sessionId = c.req.query('session_id');
    const search = c.req.query('search');
    const rank = c.req.query('rank');

    const db = getDb(c.env.DB);
    const rows = await loadRoster(db, { rank, sessionId, search, station });
    return c.json({
      members: rows,
      total: rows.length,
      station,
      rule: stationRuleText(station),
      title: stationTitle(station),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[eligible-for-error]', { msg, stack });
    return c.json({ error: 'eligibility_load_failed', detail: msg }, 500);
  }
});

// Direct credential toggles lack an approved effective-dated credential ledger.
router.post('/:id{\\d+}/credentials/:credentialId{\\d+}', requireStepUpAuth(), (c) =>
  retiredLegacyMemberWrite(c, 'credential_change'),
);

const BidOrderPatchSchema = z
  .object({
    session_id: z.string().min(1),
    overrides: z
      .array(
        z.object({
          member_id: z.number().int().positive(),
          override_ordinal: z.number().int().positive(),
        }),
      )
      .min(1),
  })
  .strict();

// PATCH /api/admin/members/bid-order — upsert manual override rows.
router.patch('/bid-order', requireStepUpAuth(), async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = BidOrderPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const { session_id, overrides } = parsed.data;

  const db = getDb(c.env.DB);

  const session = await db.select().from(bidSessions).where(eq(bidSessions.id, session_id)).get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);

  // Validate member ids exist. Chunked because a full-roster reorder can
  // include 200+ ids — D1 caps placeholders per statement.
  const memberIds = overrides.map((o) => o.member_id);
  const existing = await chunkedInArraySelect(memberIds, (chunk) =>
    db.select({ id: members.id }).from(members).where(inArray(members.id, chunk)).all(),
  );
  if (existing.length !== memberIds.length) {
    const found = new Set(existing.map((e) => e.id));
    const missing = memberIds.filter((id) => !found.has(id));
    return c.json({ error: 'unknown_members', missing }, 400);
  }

  const now = new Date();
  const actorId = c.get('claims').sub > 0 ? c.get('claims').sub : 0;
  await c.env.DB.batch([
    ...overrides.map((override) =>
      c.env.DB
        .prepare(
          `INSERT INTO manual_bid_order_override
             (bid_session_id, member_id, override_ordinal, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(bid_session_id, member_id) DO UPDATE SET
             override_ordinal = excluded.override_ordinal`,
        )
        .bind(session_id, override.member_id, override.override_ordinal, now.getTime()),
    ),
    auditInsertStatement(c.env.DB, {
      bidSessionId: session_id,
      actorType: 'admin',
      actorId,
      action: 'override_rule',
      targetKind: 'manual_bid_order_override',
      targetId: session_id,
      afterState: { overrides },
    }),
  ]);

  return c.json({ updated: overrides.length });
});

// POST /api/admin/members/seed-from-synthesis — bulk bootstrap members AND
// their inferred 2025 credentials from the analysis script output
// (members_2026_synthesis.json). Used by the Master Roster "Pre-fill from 2025
// picks" button to make staging usable in one click on an empty DB.
//
// Idempotent: existing members are updated in place (rank/seniority/category);
// missing members are inserted; inferred credentials that aren't already on a
// member are linked. Members whose synthesis-rank can't be mapped or whose
// rsc_seniority is missing are reported in `skippedMembers`.
const SYNTH_RANK_MAP: Record<string, 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF'> = {
  Firefighter: 'FF',
  Lieutenant: 'LT',
  Captain: 'CPT',
  'Division Chief': 'DC',
  'Deputy Fire Chief': 'DEP_CHIEF',
  'Fire Chief': 'CHIEF',
};

/**
 * Specialty certs that can be inferred from a member's 2025 position ID alone.
 * Position IDs are formatted `<shift><station><role>`, e.g. `B201` = B-shift,
 * Station 2, role 01 (Captain). Holding a Station-2 position in 2025 implies
 * the member already had the six TRT Ops certs (otherwise they couldn't have
 * been picked). Marine 8, Air Tech 810, and Captain 5 are Days-only positions
 * not present in the 2025 shift bid, so those certs are manually toggled by
 * the chief.
 */
const TRT_OPERATIONS_CERTS: ReadonlyArray<string> = [
  'Hazardous Materials Operations',
  'Rope Rescue Operations',
  'Confined Space Operations',
  'Structural Collapse Operations',
  'Trench Rescue Operations',
  'Vehicle & Machinery Rescue Operations',
];

function specialtyCertsFromPosition(
  position2025: string | undefined | null,
): ReadonlyArray<string> {
  if (!position2025) return [];
  if (/^[A-D]2\d{2,3}$/.test(position2025)) {
    return TRT_OPERATIONS_CERTS;
  }
  return [];
}

/**
 * The endpoint accepts two shapes:
 *   1. Legacy array form — `[{ employee_id, current_rank, inferred_certs_2025, ... }, ...]`
 *      (the original synthesis.json produced by the analysis script).
 *   2. New wrapped form — `{ members: [{ employee_id, rank, credentials: [...] }, ...] }`
 *      (the canonical credentials PDF extract — richer per-member cert lists).
 * The two are merged at the field level: `credentials` and `inferred_certs_2025`
 * both feed into the same cert list; `straight_seniority` and `rsc_seniority`
 * both feed into rsc_seniority.
 */
interface SynthesisRow {
  employee_id: number | string;
  first_name?: string;
  last_name?: string;
  // rank labels — either form accepted
  current_rank?: string;
  bid_rank?: string;
  rank?: string;
  bid_category?: string;
  bid?: string;
  // seniority — either spelling accepted
  rsc_seniority?: number | string | null;
  straight_seniority?: number | string | null;
  rank_seniority?: number | string | null;
  // cert lists — both merged
  inferred_certs_2025?: ReadonlyArray<string>;
  credentials?: ReadonlyArray<string>;
  position_2025?: string | null;
}

router.post('/seed-from-synthesis', requireStepUpAuth(), async (c) => {
  // Keep the old normalizer physically unreachable while the deprecated source
  // is removed from the codebase. The guard executes before request parsing or
  // database access, so it cannot create a partial bootstrap or audit record.
  if (RETIRED_LEGACY_MEMBER_WRITE_OPERATIONS.has('synthesis_seed')) {
    return retiredLegacyMemberWrite(c, 'synthesis_seed');
  }

  let raw: unknown;
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: 'file_required' }, 400);
    }
    const text = await file.text();
    try {
      raw = JSON.parse(text);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
  } else {
    raw = await c.req.json().catch(() => null);
  }

  // Accept either a top-level array (legacy synthesis shape) or a wrapped
  // `{ members: [...] }` object (new credentials-PDF extract shape).
  let rows: ReadonlyArray<SynthesisRow>;
  if (Array.isArray(raw)) {
    rows = raw as ReadonlyArray<SynthesisRow>;
  } else if (
    raw !== null &&
    typeof raw === 'object' &&
    'members' in raw &&
    Array.isArray((raw as { members: unknown }).members)
  ) {
    rows = (raw as { members: ReadonlyArray<SynthesisRow> }).members;
  } else {
    return c.json({ error: 'expected_array_or_members_wrapper' }, 400);
  }

  const db = getDb(c.env.DB);
  const rawDB = c.env.DB;
  const allCreds = await db
    .select({ id: credentialsTable.id, name: credentialsTable.name })
    .from(credentialsTable)
    .all();
  const credIdByName = new Map(allCreds.map((c2) => [c2.name, c2.id]));

  const missingCredentialsSet = new Set<string>();
  const skippedMembers: Array<{ employee_id: string; reason: string }> = [];
  let membersInserted = 0;
  let membersUpdated = 0;
  let certsInserted = 0;
  const nowMs = Date.now();

  interface NormalizedRow {
    employeeId: string;
    firstName: string;
    lastName: string;
    rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
    bidCategory: 'OFC' | 'FF' | 'EXCLUDED';
    rscSeniority: number;
    rankSeniority: number | null;
    certs: string[];
  }

  // --- Pass 1: normalize / validate every row in pure JS (no DB I/O). -----
  const normalized: NormalizedRow[] = [];
  const seenEmpIds = new Set<string>();
  for (const row of rows) {
    const employeeId = String(row.employee_id ?? '').trim();
    if (employeeId === '') continue;
    if (seenEmpIds.has(employeeId)) continue; // dedupe within payload
    seenEmpIds.add(employeeId);

    if (String(row.bid ?? 'Include').toLowerCase() === 'exclude') {
      skippedMembers.push({ employee_id: employeeId, reason: 'bid=Exclude' });
      continue;
    }

    const rankLabel = String(row.current_rank ?? row.rank ?? row.bid_rank ?? '').trim();
    const rankResolved = SYNTH_RANK_MAP[rankLabel];
    if (rankResolved === undefined) {
      skippedMembers.push({ employee_id: employeeId, reason: `unknown_rank:${rankLabel}` });
      continue;
    }

    const bidCategoryRaw = String(row.bid_category ?? '')
      .trim()
      .toUpperCase();
    const bidCategory: 'OFC' | 'FF' | 'EXCLUDED' =
      bidCategoryRaw === 'OFC' || bidCategoryRaw === 'FF' || bidCategoryRaw === 'EXCLUDED'
        ? (bidCategoryRaw as 'OFC' | 'FF' | 'EXCLUDED')
        : rankResolved === 'FF'
          ? 'FF'
          : 'OFC';

    // rsc_seniority: accept legacy `rsc_seniority` or new `straight_seniority`
    const rscSeniorityRaw = row.rsc_seniority ?? row.straight_seniority;
    const rscSeniority =
      typeof rscSeniorityRaw === 'number'
        ? Math.floor(rscSeniorityRaw)
        : typeof rscSeniorityRaw === 'string' && rscSeniorityRaw.length > 0
          ? Math.floor(Number(rscSeniorityRaw))
          : Number.NaN;
    if (!Number.isFinite(rscSeniority) || rscSeniority < 0) {
      skippedMembers.push({ employee_id: employeeId, reason: 'missing_rsc_seniority' });
      continue;
    }

    const rankSeniorityRaw = row.rank_seniority;
    const rankSeniority =
      typeof rankSeniorityRaw === 'number'
        ? Math.floor(rankSeniorityRaw)
        : typeof rankSeniorityRaw === 'string' && rankSeniorityRaw.length > 0
          ? Math.floor(Number(rankSeniorityRaw))
          : null;

    const firstName = String(row.first_name ?? '').trim();
    const lastName = String(row.last_name ?? '').trim();
    if (firstName === '' || lastName === '') {
      skippedMembers.push({ employee_id: employeeId, reason: 'missing_name' });
      continue;
    }

    // Merge legacy `inferred_certs_2025` + new `credentials` + position-derived
    // TRT certs. Dedupe so we never process the same cert twice per member.
    const certs = Array.from(
      new Set<string>([
        ...(row.inferred_certs_2025 ?? []),
        ...(row.credentials ?? []),
        ...specialtyCertsFromPosition(row.position_2025 ?? null),
      ]),
    );

    normalized.push({
      employeeId,
      firstName,
      lastName,
      rank: rankResolved,
      bidCategory,
      rscSeniority,
      rankSeniority,
      certs,
    });
  }

  // --- Pass 2: pre-fetch which members already exist (chunked IN-query). ---
  const empIds = normalized.map((r) => r.employeeId);
  const existingRows = await chunkedInArraySelect(empIds, (chunk) =>
    db
      .select({ id: members.id, employeeId: members.employeeId })
      .from(members)
      .where(inArray(members.employeeId, chunk))
      .all(),
  );
  const memberIdByEmp = new Map<string, number>(existingRows.map((r) => [r.employeeId, r.id]));

  // --- Pass 3: batch INSERT all new members, batch UPDATE existing ones. ---
  const insertStmts: D1PreparedStatement[] = [];
  const insertEmpIds: string[] = [];
  const updateStmts: D1PreparedStatement[] = [];

  for (const r of normalized) {
    const existingId = memberIdByEmp.get(r.employeeId);
    if (existingId === undefined) {
      insertEmpIds.push(r.employeeId);
      insertStmts.push(
        rawDB
          .prepare(
            'INSERT INTO members ' +
              '(employee_id, first_name, last_name, rank, bid_category, rsc_seniority, rank_seniority, is_probationary, created_at, updated_at) ' +
              'VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
          )
          .bind(
            r.employeeId,
            r.firstName,
            r.lastName,
            r.rank,
            r.bidCategory,
            r.rscSeniority,
            r.rankSeniority,
            nowMs,
            nowMs,
          ),
      );
    } else {
      updateStmts.push(
        rawDB
          .prepare(
            'UPDATE members SET first_name = ?, last_name = ?, rank = ?, ' +
              'bid_category = ?, rsc_seniority = ?, rank_seniority = ?, updated_at = ? WHERE id = ?',
          )
          .bind(
            r.firstName,
            r.lastName,
            r.rank,
            r.bidCategory,
            r.rscSeniority,
            r.rankSeniority,
            nowMs,
            existingId,
          ),
      );
    }
  }

  if (insertStmts.length > 0) {
    // D1.batch executes statements in order; RETURNING semantics aren't
    // portable across the real-D1 and miniflare-D1 runtimes, so we follow up
    // with a single chunked SELECT to resolve the new auto-incremented ids.
    const head = insertStmts[0];
    if (head !== undefined) {
      await rawDB.batch([head, ...insertStmts.slice(1)]);
      const resolved = await chunkedInArraySelect(insertEmpIds, (chunk) =>
        db
          .select({ id: members.id, employeeId: members.employeeId })
          .from(members)
          .where(inArray(members.employeeId, chunk))
          .all(),
      );
      for (const r2 of resolved) {
        if (!memberIdByEmp.has(r2.employeeId)) {
          memberIdByEmp.set(r2.employeeId, r2.id);
          membersInserted += 1;
        }
      }
      // Anything we expected to insert but didn't surface is reported.
      for (const emp of insertEmpIds) {
        if (!memberIdByEmp.has(emp)) {
          skippedMembers.push({ employee_id: emp, reason: 'insert_failed' });
        }
      }
    }
  }

  if (updateStmts.length > 0) {
    const head = updateStmts[0];
    if (head !== undefined) {
      await rawDB.batch([head, ...updateStmts.slice(1)]);
      membersUpdated = updateStmts.length;
    }
  }

  // --- Pass 4: compute desired cert links, pre-fetch existing links. ------
  interface DesiredLink {
    memberId: number;
    credentialId: number;
  }
  const desiredLinks: DesiredLink[] = [];
  for (const r of normalized) {
    const memberId = memberIdByEmp.get(r.employeeId);
    if (memberId === undefined) continue;
    for (const certName of r.certs) {
      const cid = credIdByName.get(certName);
      if (cid === undefined) {
        missingCredentialsSet.add(certName);
        continue;
      }
      desiredLinks.push({ memberId, credentialId: cid });
    }
  }

  if (desiredLinks.length > 0) {
    const affectedMemberIds = Array.from(new Set(desiredLinks.map((l) => l.memberId)));
    const existingLinks = await chunkedInArraySelect(affectedMemberIds, (chunk) =>
      db
        .select({
          memberId: memberCredentials.memberId,
          credentialId: memberCredentials.credentialId,
        })
        .from(memberCredentials)
        .where(inArray(memberCredentials.memberId, chunk))
        .all(),
    );
    const linkKeySet = new Set<string>(existingLinks.map((l) => `${l.memberId}:${l.credentialId}`));

    // --- Pass 5: batch INSERT new cert links (chunked at 100 per batch). ---
    const newLinkStmts: D1PreparedStatement[] = [];
    for (const l of desiredLinks) {
      const key = `${l.memberId}:${l.credentialId}`;
      if (linkKeySet.has(key)) continue;
      linkKeySet.add(key); // also dedupes duplicates within this payload
      newLinkStmts.push(
        rawDB
          .prepare('INSERT INTO member_credentials (member_id, credential_id) VALUES (?, ?)')
          .bind(l.memberId, l.credentialId),
      );
    }

    if (newLinkStmts.length > 0) {
      const BATCH_LIMIT = 100;
      for (let i = 0; i < newLinkStmts.length; i += BATCH_LIMIT) {
        const slice = newLinkStmts.slice(i, i + BATCH_LIMIT);
        const head = slice[0];
        if (head !== undefined) {
          await rawDB.batch([head, ...slice.slice(1)]);
        }
      }
      certsInserted = newLinkStmts.length;
    }
  }

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub > 0 ? c.get('claims').sub : 0,
    action: 'members_import',
    targetKind: 'synthesis_seed',
    afterState: {
      membersInserted,
      membersUpdated,
      certsInserted,
      skippedMembers: skippedMembers.length,
      missingCredentials: missingCredentialsSet.size,
    },
  });

  return c.json({
    membersInserted,
    membersUpdated,
    certsInserted,
    skippedMembers,
    missingCredentials: [...missingCredentialsSet],
  });
});

export default router;

import { MemberImportRowSchema } from '@mbfd/shared';
import type { JwtPayload } from '@mbfd/shared';
import { type SQL, and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import {
  bidSessions,
  credentials as credentialsTable,
  manualBidOrderOverride,
  memberCredentials,
  members,
} from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
import { computeBidOrder } from '../../lib/bid-order.js';
import { parseCsv } from '../../lib/csv-parser.js';
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

const MemberPatchSchema = z
  .object({
    rank: z.enum(['FF', 'LT', 'CPT', 'DC', 'DEP_CHIEF', 'CHIEF']).optional(),
    bid_category: z.enum(['OFC', 'FF', 'EXCLUDED']).optional(),
    rsc_seniority: z.number().int().nonnegative().optional(),
    rank_seniority: z.number().int().nonnegative().nullable().optional(),
    is_probationary: z.boolean().optional(),
    credentials: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });

const router = new Hono<AdminEnv>();

router.use('*', requireAdmin);

router.post('/import', requireStepUpAuth(), async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'file_required' }, 400);
  }

  const text = await file.text();
  const { ok, errors } = await parseCsv(text, MemberImportRowSchema);

  const db = getDb(c.env.DB);
  const now = new Date();
  let inserted = 0;
  let updated = 0;

  for (const row of ok) {
    const existing = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.employeeId, row.employeeId))
      .get();

    if (existing !== undefined) {
      await db
        .update(members)
        .set({
          firstName: row.firstName,
          lastName: row.lastName,
          rank: row.rank,
          bidCategory: row.bidCategory,
          rscSeniority: row.rscSeniority,
          hiredAt: row.hiredAt ?? null,
          promotedAt: row.promotedAt ?? null,
          updatedAt: now,
        })
        .where(eq(members.employeeId, row.employeeId));
      updated += 1;
    } else {
      await db.insert(members).values({
        employeeId: row.employeeId,
        firstName: row.firstName,
        lastName: row.lastName,
        rank: row.rank,
        bidCategory: row.bidCategory,
        rscSeniority: row.rscSeniority,
        hiredAt: row.hiredAt ?? null,
        promotedAt: row.promotedAt ?? null,
        isProbationary: false,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }
  }

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub ?? null,
    action: 'members_import',
    afterState: { inserted, updated, errorCount: errors.length },
  });
  return c.json({ inserted, updated, errors });
});

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

// PATCH /api/admin/members/:id
router.patch('/:id{\\d+}', requireStepUpAuth(), async (c) => {
  const id = Number(c.req.param('id'));
  const raw = await c.req.json().catch(() => null);
  const parsed = MemberPatchSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const patch = parsed.data;

  const db = getDb(c.env.DB);
  const existing = await db.select().from(members).where(eq(members.id, id)).get();
  if (existing === undefined) return c.json({ error: 'not_found' }, 404);

  // Resolve credential names -> ids; reject unknown names.
  let resolvedCredIds: number[] | undefined;
  if (patch.credentials !== undefined) {
    const all = await db
      .select({ id: credentialsTable.id, name: credentialsTable.name })
      .from(credentialsTable)
      .all();
    const byName = new Map(all.map((r) => [r.name, r.id]));
    const missing: string[] = [];
    resolvedCredIds = [];
    for (const name of patch.credentials) {
      const cid = byName.get(name);
      if (cid === undefined) missing.push(name);
      else resolvedCredIds.push(cid);
    }
    if (missing.length > 0) {
      return c.json({ error: 'unknown_credentials', missing }, 400);
    }
  }

  const now = new Date();
  const setObj: Partial<typeof members.$inferInsert> = { updatedAt: now };
  if (patch.rank !== undefined) setObj.rank = patch.rank;
  if (patch.bid_category !== undefined) setObj.bidCategory = patch.bid_category;
  if (patch.rsc_seniority !== undefined) setObj.rscSeniority = patch.rsc_seniority;
  if (patch.rank_seniority !== undefined) setObj.rankSeniority = patch.rank_seniority;
  if (patch.is_probationary !== undefined) setObj.isProbationary = patch.is_probationary;

  await db.update(members).set(setObj).where(eq(members.id, id));

  if (resolvedCredIds !== undefined) {
    await db.delete(memberCredentials).where(eq(memberCredentials.memberId, id));
    for (const cid of resolvedCredIds) {
      await db.insert(memberCredentials).values({ memberId: id, credentialId: cid });
    }
  }

  const updated = await db.select().from(members).where(eq(members.id, id)).get();

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub > 0 ? c.get('claims').sub : 0,
    action: 'override_cert',
    targetKind: 'member',
    targetId: String(id),
    beforeState: existing,
    afterState: updated,
  });

  return c.json({ member: updated });
});

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
  const credsRows = await db
    .select({
      memberId: memberCredentials.memberId,
      credentialId: memberCredentials.credentialId,
      credentialName: credentialsTable.name,
    })
    .from(memberCredentials)
    .innerJoin(credentialsTable, eq(memberCredentials.credentialId, credentialsTable.id))
    .where(inArray(memberCredentials.memberId, ids))
    .all();

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

// POST /api/admin/members/:id/credentials/:credentialId — toggle a single cert.
router.post('/:id{\\d+}/credentials/:credentialId{\\d+}', requireStepUpAuth(), async (c) => {
  const memberId = Number(c.req.param('id'));
  const credentialId = Number(c.req.param('credentialId'));

  const db = getDb(c.env.DB);

  const member = await db.select().from(members).where(eq(members.id, memberId)).get();
  if (member === undefined) return c.json({ error: 'member_not_found' }, 404);

  const cred = await db
    .select()
    .from(credentialsTable)
    .where(eq(credentialsTable.id, credentialId))
    .get();
  if (cred === undefined) return c.json({ error: 'credential_not_found' }, 404);

  const existing = await db
    .select()
    .from(memberCredentials)
    .where(
      and(
        eq(memberCredentials.memberId, memberId),
        eq(memberCredentials.credentialId, credentialId),
      ),
    )
    .get();

  let held: boolean;
  if (existing === undefined) {
    await db.insert(memberCredentials).values({ memberId, credentialId });
    held = true;
  } else {
    await db
      .delete(memberCredentials)
      .where(
        and(
          eq(memberCredentials.memberId, memberId),
          eq(memberCredentials.credentialId, credentialId),
        ),
      );
    held = false;
  }

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub > 0 ? c.get('claims').sub : 0,
    action: 'override_cert',
    targetKind: 'member_credential',
    targetId: `${memberId}:${credentialId}`,
    beforeState: existing === undefined ? { held: false } : { held: true },
    afterState: { held },
  });

  return c.json({ held });
});

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

  // Validate member ids exist.
  const memberIds = overrides.map((o) => o.member_id);
  const existing = await db
    .select({ id: members.id })
    .from(members)
    .where(inArray(members.id, memberIds))
    .all();
  if (existing.length !== memberIds.length) {
    const found = new Set(existing.map((e) => e.id));
    const missing = memberIds.filter((id) => !found.has(id));
    return c.json({ error: 'unknown_members', missing }, 400);
  }

  const now = new Date();
  for (const o of overrides) {
    const exists = await db
      .select()
      .from(manualBidOrderOverride)
      .where(
        and(
          eq(manualBidOrderOverride.bidSessionId, session_id),
          eq(manualBidOrderOverride.memberId, o.member_id),
        ),
      )
      .get();
    if (exists === undefined) {
      await db.insert(manualBidOrderOverride).values({
        bidSessionId: session_id,
        memberId: o.member_id,
        overrideOrdinal: o.override_ordinal,
        createdAt: now,
      });
    } else {
      await db
        .update(manualBidOrderOverride)
        .set({ overrideOrdinal: o.override_ordinal })
        .where(
          and(
            eq(manualBidOrderOverride.bidSessionId, session_id),
            eq(manualBidOrderOverride.memberId, o.member_id),
          ),
        );
    }
  }

  await writeAuditLog(db, {
    bidSessionId: session_id,
    actorType: 'admin',
    actorId: c.get('claims').sub > 0 ? c.get('claims').sub : 0,
    action: 'override_rule',
    targetKind: 'manual_bid_order_override',
    targetId: session_id,
    afterState: { overrides },
  });

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

interface SynthesisRow {
  employee_id: number | string;
  first_name?: string;
  last_name?: string;
  current_rank?: string;
  bid_rank?: string;
  bid_category?: string;
  bid?: string;
  rsc_seniority?: number | string | null;
  rank_seniority?: number | string | null;
  inferred_certs_2025?: ReadonlyArray<string>;
}

router.post('/seed-from-synthesis', requireStepUpAuth(), async (c) => {
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

  if (!Array.isArray(raw)) {
    return c.json({ error: 'expected_array' }, 400);
  }

  const db = getDb(c.env.DB);
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
  const now = new Date();

  for (const row of raw as SynthesisRow[]) {
    const employeeId = String(row.employee_id ?? '').trim();
    if (employeeId === '') {
      continue;
    }
    if (String(row.bid ?? 'Include').toLowerCase() === 'exclude') {
      skippedMembers.push({ employee_id: employeeId, reason: 'bid=Exclude' });
      continue;
    }

    const rankLabel = String(row.current_rank ?? row.bid_rank ?? '').trim();
    const rank = SYNTH_RANK_MAP[rankLabel];
    if (rank === undefined) {
      skippedMembers.push({ employee_id: employeeId, reason: `unknown_rank:${rankLabel}` });
      continue;
    }

    const bidCategoryRaw = String(row.bid_category ?? '')
      .trim()
      .toUpperCase();
    const bidCategory: 'OFC' | 'FF' | 'EXCLUDED' =
      bidCategoryRaw === 'OFC' || bidCategoryRaw === 'FF' || bidCategoryRaw === 'EXCLUDED'
        ? (bidCategoryRaw as 'OFC' | 'FF' | 'EXCLUDED')
        : rank === 'FF'
          ? 'FF'
          : 'OFC';

    const rscSeniorityRaw = row.rsc_seniority;
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

    const existing = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.employeeId, employeeId))
      .get();

    let memberId: number;
    if (existing === undefined) {
      const inserted = await db
        .insert(members)
        .values({
          employeeId,
          firstName,
          lastName,
          rank,
          bidCategory,
          rscSeniority,
          rankSeniority,
          isProbationary: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: members.id });
      const newId = inserted[0]?.id;
      if (newId === undefined) {
        skippedMembers.push({ employee_id: employeeId, reason: 'insert_failed' });
        continue;
      }
      memberId = newId;
      membersInserted += 1;
    } else {
      memberId = existing.id;
      await db
        .update(members)
        .set({
          firstName,
          lastName,
          rank,
          bidCategory,
          rscSeniority,
          rankSeniority,
          updatedAt: now,
        })
        .where(eq(members.id, memberId));
      membersUpdated += 1;
    }

    const certs = row.inferred_certs_2025 ?? [];
    for (const certName of certs) {
      const cid = credIdByName.get(certName);
      if (cid === undefined) {
        missingCredentialsSet.add(certName);
        continue;
      }
      const link = await db
        .select()
        .from(memberCredentials)
        .where(
          and(eq(memberCredentials.memberId, memberId), eq(memberCredentials.credentialId, cid)),
        )
        .get();
      if (link === undefined) {
        await db.insert(memberCredentials).values({ memberId, credentialId: cid });
        certsInserted += 1;
      }
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

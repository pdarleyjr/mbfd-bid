import { type JwtPayload, ReasonCodeSchema } from '@mbfd/shared';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import {
  bidYears,
  positionRules,
  positionStaffingBindings,
  positionTemplates,
  positions,
  ruleBooks,
  staffingPositions,
} from '../../db/schema.js';
import { auditInsertStatement } from '../../lib/audit.js';
import {
  REVIEWED_2026_DRAFT_RULE_BOOK,
  REVIEWED_2026_SOURCE_PROVENANCE,
  REVIEWED_2026_SOURCE_TEMPLATE,
  buildReviewed2026Source,
} from '../../lib/reviewed-2026-source.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<AdminEnv>();

const ReconcileStationSixSchema = z
  .object({
    reason_code: ReasonCodeSchema,
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

const STATION_SIX_SOURCE = '2026.1';
const STATION_SIX_TARGET = '2026.2';
const STATION_SIX_RULE_BOOK = '2026.2';
const REVIEWED_SOURCE_REFERENCE =
  'User-supplied 2026 Bid policy v3, staffing guidance, assignment source, credentials package, and workbook package';
const ADMINISTRATIVE_DIVISION_CHIEF_BINDINGS = [
  { positionId: 'A211', shift: 'A Shift', shiftCode: 'A' },
  { positionId: 'B211', shift: 'B Shift', shiftCode: 'B' },
  { positionId: 'C211', shift: 'C Shift', shiftCode: 'C' },
] as const;
const MARINE_COMMON = [
  'Merchant Mariner Credential (MMC)',
  'IADRS Swim Evaluation',
  'Hazardous Materials Operations',
  'Open Water Diver Certified',
  'Fire Boat Operator Qualifications',
];

type AdministrativeStaffingSlot = {
  id: string;
  shift: string | null;
  station: string | null;
  unit: string | null;
  positionName: string | null;
  reviewStatus: string;
};

export function resolveStationSixAdministrativeBindings(
  staffingSlots: AdministrativeStaffingSlot[],
):
  | {
      ok: true;
      bindings: Array<{
        positionId: string;
        staffingPositionId: string;
        authoritativeSourceRef: string;
      }>;
    }
  | { ok: false; code: 'administrative_division_chief_staffing_shape_unrecognized' } {
  const bindings: Array<{
    positionId: string;
    staffingPositionId: string;
    authoritativeSourceRef: string;
  }> = [];
  for (const expected of ADMINISTRATIVE_DIVISION_CHIEF_BINDINGS) {
    const matches = staffingSlots.filter(
      (slot) =>
        slot.shift === expected.shift &&
        slot.station === 'Division Chief' &&
        slot.unit === 'Division Chief 300' &&
        slot.positionName === 'Division Chief' &&
        slot.reviewStatus === 'approved',
    );
    const match = matches[0];
    if (matches.length !== 1 || match === undefined) {
      return { ok: false, code: 'administrative_division_chief_staffing_shape_unrecognized' };
    }
    bindings.push({
      positionId: expected.positionId,
      staffingPositionId: match.id,
      authoritativeSourceRef: `staffing:2026-08-24/division-chief/${expected.shiftCode}`,
    });
  }
  return { ok: true, bindings };
}

function correctedMarineRule(positionId: string) {
  const suffix = positionId.slice(-1);
  const requiresDriverEngineer = suffix === '2' || suffix === '3';
  const credentials = requiresDriverEngineer
    ? [...MARINE_COMMON, 'Driver Engineer Qualified']
    : MARINE_COMMON;
  const items = [
    ...credentials.map((credential) => ({ points: 1, credential })),
    { points: 1, credential: 'Public Safety Diver' },
    ...(suffix === '1' ? [] : [{ points: 2, credential: 'Car Seat Technician' }]),
  ];
  return {
    requiredCriteria: JSON.stringify({
      rank: [suffix === '1' ? 'CPT' : 'FF'],
      credentials,
      custom: [],
    }),
    pointsPreference: JSON.stringify({
      max: items.reduce((total, item) => total + item.points, 0),
      items,
    }),
    tieBreakChain: JSON.stringify(['points', 'mo_points', 'rsc_seniority', 'rank_seniority']),
    notes: '2026 policy v3 Station 6 reconciliation from 2026-08-24 staffing source',
  };
}

router.use('*', requireAdmin);

router.get('/', async (c) => {
  const templateVersion = c.req.query('template_version');
  if (!templateVersion) {
    return c.json({ error: 'template_version required' }, 400);
  }

  const shift = c.req.query('shift') as 'A' | 'B' | 'C' | 'D' | undefined;
  const station = c.req.query('station');

  const db = getDb(c.env.DB);

  const filters: SQL[] = [eq(positions.templateVersion, templateVersion)];
  if (shift) {
    filters.push(eq(positions.shift, shift));
  }
  if (station) {
    filters.push(eq(positions.station, station));
  }

  const list = await db
    .select()
    .from(positions)
    .where(and(...filters))
    .all();

  return c.json({ positions: list, templateVersion, count: list.length });
});

router.post('/clone-from-year/:src_version', requireStepUpAuth(), async (c) => {
  const srcVersion = c.req.param('src_version');
  const body = await c.req.json<{ destVersion?: string; destYear?: number }>();

  if (!body.destVersion || typeof body.destYear !== 'number') {
    return c.json({ error: 'destVersion and destYear required' }, 400);
  }

  const { destVersion, destYear } = body;

  const db = getDb(c.env.DB);

  const src = await db
    .select()
    .from(positionTemplates)
    .where(eq(positionTemplates.version, srcVersion))
    .get();

  if (!src) {
    return c.json({ error: 'src_version_not_found' }, 404);
  }

  const existing = await db
    .select()
    .from(positionTemplates)
    .where(eq(positionTemplates.version, destVersion))
    .get();

  if (existing) {
    return c.json({ error: 'dest_version_already_exists' }, 409);
  }

  const srcPositions = await db
    .select()
    .from(positions)
    .where(eq(positions.templateVersion, srcVersion))
    .all();

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO position_templates (version, effective_year) VALUES (?, ?)').bind(
      destVersion,
      destYear,
    ),
    c.env.DB.prepare(
      `INSERT INTO positions
           (id, template_version, shift, station, division, unit, rank_required,
            position_name, is_floating, is_vacant_by_design, is_excluded_from_count)
         SELECT id, ?, shift, station, division, unit, rank_required,
                position_name, is_floating, is_vacant_by_design, is_excluded_from_count
           FROM positions WHERE template_version = ?`,
    ).bind(destVersion, srcVersion),
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'positions_clone',
      targetKind: 'position_template',
      targetId: destVersion,
      afterState: { srcVersion, destVersion, copied: srcPositions.length },
    }),
  ]);
  return c.json({ destVersion, destYear, copied: srcPositions.length });
});

/**
 * Authenticated one-time bridge from an empty production database to the
 * reviewed 2026 annual configuration workflow. It creates an immutable source
 * snapshot and a cloned draft in one D1 batch. It never designates, publishes,
 * or starts a Bid; the ordinary reconciliation and configuration routes retain
 * those separate gates.
 */
router.post('/bootstrap-reviewed-2026-source', requireStepUpAuth(), async (c) => {
  const parsed = ReconcileStationSixSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  if (parsed.data.reason_code !== 'rule_override.policy_direction') {
    return c.json({ error: 'invalid_reason_for_action' }, 400);
  }

  const db = getDb(c.env.DB);
  const [year, sourceTemplate, targetTemplate, sourceBook, draftBook] = await Promise.all([
    db.select().from(bidYears).where(eq(bidYears.year, 2026)).get(),
    db
      .select()
      .from(positionTemplates)
      .where(eq(positionTemplates.version, REVIEWED_2026_SOURCE_TEMPLATE))
      .get(),
    db
      .select()
      .from(positionTemplates)
      .where(eq(positionTemplates.version, STATION_SIX_TARGET))
      .get(),
    db.select().from(ruleBooks).where(eq(ruleBooks.version, REVIEWED_2026_SOURCE_TEMPLATE)).get(),
    db.select().from(ruleBooks).where(eq(ruleBooks.version, REVIEWED_2026_DRAFT_RULE_BOOK)).get(),
  ]);

  if (year === undefined) return c.json({ error: 'bid_year_not_found' }, 404);
  if (
    year.status !== 'configuring' ||
    year.positionTemplateVersion !== null ||
    year.ruleBookVersion !== null
  ) {
    return c.json({ error: 'bid_year_already_designated' }, 409);
  }

  const stateCounts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM positions WHERE template_version = ?) AS source_positions,
       (SELECT COUNT(*) FROM positions WHERE template_version = ?) AS target_positions,
       (SELECT COUNT(*) FROM position_rules WHERE rule_book_version = ?) AS source_rules,
       (SELECT COUNT(*) FROM position_rules WHERE rule_book_version = ?) AS draft_rules,
       (SELECT COUNT(*) FROM rule_book_position_participation WHERE rule_book_version = ?) AS source_participation,
       (SELECT COUNT(*) FROM rule_book_position_participation WHERE rule_book_version = ?) AS draft_participation`,
  )
    .bind(
      REVIEWED_2026_SOURCE_TEMPLATE,
      STATION_SIX_TARGET,
      REVIEWED_2026_SOURCE_TEMPLATE,
      REVIEWED_2026_DRAFT_RULE_BOOK,
      REVIEWED_2026_SOURCE_TEMPLATE,
      REVIEWED_2026_DRAFT_RULE_BOOK,
    )
    .first<{
      source_positions: number;
      target_positions: number;
      source_rules: number;
      draft_rules: number;
      source_participation: number;
      draft_participation: number;
    }>();
  if (stateCounts === null) return c.json({ error: 'reviewed_source_state_unavailable' }, 500);

  const preReconciliationComplete =
    sourceTemplate !== undefined &&
    targetTemplate === undefined &&
    sourceBook?.status === 'archived' &&
    draftBook?.status === 'draft' &&
    stateCounts.source_positions === 233 &&
    stateCounts.target_positions === 0 &&
    stateCounts.source_rules === 229 &&
    stateCounts.draft_rules === 229 &&
    stateCounts.source_participation === 3 &&
    stateCounts.draft_participation === 3;
  const postReconciliationComplete =
    sourceTemplate !== undefined &&
    targetTemplate !== undefined &&
    sourceBook?.status === 'archived' &&
    draftBook?.status === 'draft' &&
    stateCounts.source_positions === 233 &&
    stateCounts.target_positions === 242 &&
    stateCounts.source_rules === 229 &&
    stateCounts.draft_rules === 238 &&
    stateCounts.source_participation === 3 &&
    stateCounts.draft_participation === 3;
  if (preReconciliationComplete || postReconciliationComplete) {
    return c.json({
      source_template_version: REVIEWED_2026_SOURCE_TEMPLATE,
      source_rule_book_version: REVIEWED_2026_SOURCE_TEMPLATE,
      draft_rule_book_version: REVIEWED_2026_DRAFT_RULE_BOOK,
      source_positions: 233,
      source_rules: 229,
      administrative_positions: 3,
      resumed: true,
    });
  }

  const emptyState =
    sourceTemplate === undefined &&
    targetTemplate === undefined &&
    sourceBook === undefined &&
    draftBook === undefined &&
    Object.values(stateCounts).every((count) => count === 0);
  if (!emptyState) {
    return c.json({ error: 'reviewed_source_state_conflict' }, 409);
  }

  const source = buildReviewed2026Source();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO position_templates (version, effective_year, notes) VALUES (?, 2026, ?)',
    ).bind(
      REVIEWED_2026_SOURCE_TEMPLATE,
      `${REVIEWED_SOURCE_REFERENCE}; source snapshot retained for traceable draft reconciliation`,
    ),
    c.env.DB.prepare(
      `INSERT INTO rule_books (version, effective_year, status, notes)
       VALUES (?, 2026, 'draft', ?), (?, 2026, 'draft', ?)`,
    ).bind(
      REVIEWED_2026_SOURCE_TEMPLATE,
      'Reviewed immutable 2026.1 source snapshot; never published as the production policy',
      REVIEWED_2026_DRAFT_RULE_BOOK,
      'Editable 2026.2 draft cloned from the reviewed source package',
    ),
  ];

  for (let offset = 0; offset < source.positions.length; offset += 8) {
    const chunk = source.positions.slice(offset, offset + 8);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO positions (
           id, template_version, shift, station, division, unit, rank_required,
           position_name, is_floating, is_vacant_by_design, is_excluded_from_count
         ) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      ).bind(
        ...chunk.flatMap((position) => [
          position.id,
          REVIEWED_2026_SOURCE_TEMPLATE,
          position.shift,
          position.station,
          position.division,
          position.unit,
          position.rankRequired,
          position.positionName,
          position.isFloating ? 1 : 0,
          position.isVacantByDesign ? 1 : 0,
          position.isExcludedFromCount ? 1 : 0,
        ]),
      ),
    );
  }

  for (const ruleBookVersion of [REVIEWED_2026_SOURCE_TEMPLATE, REVIEWED_2026_DRAFT_RULE_BOOK]) {
    for (let offset = 0; offset < source.rules.length; offset += 10) {
      const chunk = source.rules.slice(offset, offset + 10);
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO position_rules (
             rule_book_version, position_id, template_version, required_criteria,
             points_preference, tie_break_chain, notes
           ) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        ).bind(
          ...chunk.flatMap((rule) => [
            ruleBookVersion,
            rule.positionId,
            REVIEWED_2026_SOURCE_TEMPLATE,
            rule.requiredCriteria,
            rule.pointsPreference,
            rule.tieBreakChain,
            rule.notes,
          ]),
        ),
      );
    }
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO rule_book_position_participation (
           rule_book_version, position_id, template_version, bid_participation,
           authoritative_source_ref, created_at
         ) VALUES ${source.administrativePositionIds.map(() => "(?, ?, ?, 'ADMIN_ASSIGNED_NON_BIDDABLE', ?, ?)").join(', ')}`,
      ).bind(
        ...source.administrativePositionIds.flatMap((positionId) => [
          ruleBookVersion,
          positionId,
          REVIEWED_2026_SOURCE_TEMPLATE,
          '2026 Bid Policy v3 administrative Division Chief direction',
          Date.now(),
        ]),
      ),
    );
  }
  statements.push(
    // Participation rows are protected by a draft-only trigger. Archive the
    // immutable source only after those rows exist, still inside this batch.
    c.env.DB.prepare(
      "UPDATE rule_books SET status = 'archived' WHERE version = ? AND status = 'draft'",
    ).bind(REVIEWED_2026_SOURCE_TEMPLATE),
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'override_rule',
      targetKind: 'position_template',
      targetId: REVIEWED_2026_SOURCE_TEMPLATE,
      afterState: {
        source_positions: source.positions.length,
        source_rules: source.rules.length,
        draft_rule_book_version: REVIEWED_2026_DRAFT_RULE_BOOK,
        administrative_positions: source.administrativePositionIds.length,
        provenance: REVIEWED_2026_SOURCE_PROVENANCE,
      },
      reason: parsed.data.reason,
    }),
  );
  await c.env.DB.batch(statements);

  return c.json(
    {
      source_template_version: REVIEWED_2026_SOURCE_TEMPLATE,
      source_rule_book_version: REVIEWED_2026_SOURCE_TEMPLATE,
      draft_rule_book_version: REVIEWED_2026_DRAFT_RULE_BOOK,
      source_positions: source.positions.length,
      source_rules: source.rules.length,
      administrative_positions: source.administrativePositionIds.length,
      resumed: false,
    },
    201,
  );
});

/**
 * Reconciles the unconfigured 2026 staging candidate to the supplied policy
 * and the 2026-08-24 staffing list. It creates a new immutable template and
 * retargets the existing draft only; it never changes the active rule book.
 */
router.post('/reconcile-station-six', requireStepUpAuth(), async (c) => {
  const parsed = ReconcileStationSixSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  if (parsed.data.reason_code !== 'rule_override.policy_direction') {
    return c.json({ error: 'invalid_reason_for_action' }, 400);
  }

  const db = getDb(c.env.DB);
  const [year, sourceTemplate, targetTemplate, draft, sourcePositions, sourceRules, staffingRows] =
    await Promise.all([
      db.select().from(bidYears).where(eq(bidYears.year, 2026)).get(),
      db
        .select()
        .from(positionTemplates)
        .where(eq(positionTemplates.version, STATION_SIX_SOURCE))
        .get(),
      db
        .select()
        .from(positionTemplates)
        .where(eq(positionTemplates.version, STATION_SIX_TARGET))
        .get(),
      db.select().from(ruleBooks).where(eq(ruleBooks.version, STATION_SIX_RULE_BOOK)).get(),
      db.select().from(positions).where(eq(positions.templateVersion, STATION_SIX_SOURCE)).all(),
      db
        .select()
        .from(positionRules)
        .where(eq(positionRules.ruleBookVersion, STATION_SIX_RULE_BOOK))
        .all(),
      db
        .select({
          id: staffingPositions.id,
          shift: staffingPositions.shift,
          station: staffingPositions.station,
          unit: staffingPositions.unit,
          positionName: staffingPositions.positionName,
          reviewStatus: staffingPositions.reviewStatus,
        })
        .from(staffingPositions)
        .all(),
    ]);
  if (
    year === undefined ||
    (targetTemplate === undefined &&
      (year.positionTemplateVersion !== null || year.ruleBookVersion !== null))
  ) {
    return c.json({ error: 'bid_year_already_designated' }, 409);
  }
  if (sourceTemplate === undefined) return c.json({ error: 'source_template_not_found' }, 404);
  if (draft === undefined || draft.status !== 'draft') {
    return c.json({ error: 'draft_rule_book_required' }, 409);
  }
  const administrativeBindings = resolveStationSixAdministrativeBindings(staffingRows);
  if (!administrativeBindings.ok) return c.json({ error: administrativeBindings.code }, 409);
  const now = Math.floor(Date.now() / 1000);
  if (targetTemplate !== undefined) {
    const [targetPositions, targetRules, existingBindings] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(positions)
        .where(eq(positions.templateVersion, STATION_SIX_TARGET))
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(positionRules)
        .where(eq(positionRules.ruleBookVersion, STATION_SIX_RULE_BOOK))
        .get(),
      db
        .select({
          positionId: positionStaffingBindings.positionId,
          staffingPositionId: positionStaffingBindings.staffingPositionId,
          authoritativeSourceRef: positionStaffingBindings.authoritativeSourceRef,
          reviewStatus: positionStaffingBindings.reviewStatus,
        })
        .from(positionStaffingBindings)
        .where(eq(positionStaffingBindings.templateVersion, STATION_SIX_TARGET))
        .all(),
    ]);
    if (targetPositions?.count !== 242 || targetRules?.count !== 238) {
      return c.json({ error: 'target_template_shape_unrecognized' }, 409);
    }
    const expectedByPosition = new Map(
      administrativeBindings.bindings.map((binding) => [binding.positionId, binding]),
    );
    const existingShapeRecognized =
      existingBindings.length === 0 ||
      (existingBindings.length === administrativeBindings.bindings.length &&
        existingBindings.every((binding) => {
          const expected = expectedByPosition.get(binding.positionId);
          return (
            expected !== undefined &&
            binding.staffingPositionId === expected.staffingPositionId &&
            binding.authoritativeSourceRef === expected.authoritativeSourceRef &&
            binding.reviewStatus === 'approved'
          );
        }));
    if (!existingShapeRecognized) {
      return c.json({ error: 'target_template_binding_shape_unrecognized' }, 409);
    }
    if (existingBindings.length === 0) {
      await c.env.DB.batch([
        ...administrativeBindings.bindings.map((binding) =>
          c.env.DB.prepare(
            `INSERT OR IGNORE INTO position_staffing_bindings (
                 position_id, template_version, staffing_position_id, authoritative_source_ref, review_status, created_at
               ) VALUES (?, ?, ?, ?, 'approved', ?)`,
          ).bind(
            binding.positionId,
            STATION_SIX_TARGET,
            binding.staffingPositionId,
            binding.authoritativeSourceRef,
            now,
          ),
        ),
        auditInsertStatement(c.env.DB, {
          bidSessionId: null,
          actorType: 'admin',
          actorId: c.get('claims').member_id,
          action: 'override_rule',
          targetKind: 'position_staffing_binding',
          targetId: STATION_SIX_TARGET,
          afterState: {
            target_template: STATION_SIX_TARGET,
            binding_count: administrativeBindings.bindings.length,
            resumed: true,
          },
          reason: parsed.data.reason,
        }),
      ]);
    }
    return c.json({
      template_version: STATION_SIX_TARGET,
      rule_book_version: STATION_SIX_RULE_BOOK,
      positions: 242,
      rules: 238,
      station_six_roles_per_shift: 6,
      resumed: true,
    });
  }

  if (sourcePositions.length !== 233 || sourceRules.length !== 229) {
    return c.json(
      {
        error: 'unexpected_staging_source_shape',
        positions: sourcePositions.length,
        rules: sourceRules.length,
      },
      409,
    );
  }

  const sourceById = new Map(sourcePositions.map((position) => [position.id, position]));
  if (
    !['A', 'B', 'C'].every((shift) =>
      ['1', '2', '3'].every((slot) => sourceById.has(`${shift}61${slot}`)),
    )
  ) {
    return c.json({ error: 'station_six_source_incomplete' }, 409);
  }
  const correctedPositionCount = sourcePositions.length + 9;
  const correctedRuleCount = sourceRules.length + 9;
  const marineRuleRows = (['A', 'B', 'C'] as const).flatMap((shift) =>
    ['1', '2', '3', '4', '5', '6'].map((slot) => {
      const rule = correctedMarineRule(`${shift}61${slot}`);
      return [
        `${shift}61${slot}`,
        rule.requiredCriteria,
        rule.pointsPreference,
        rule.tieBreakChain,
        rule.notes,
      ] as const;
    }),
  );

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO position_templates (version, effective_year, notes) VALUES (?, ?, ?)',
    ).bind(STATION_SIX_TARGET, 2026, '2026 policy v3 and 2026-08-24 staffing reconciliation'),
    c.env.DB.prepare(
      `INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name, is_floating, is_vacant_by_design, is_excluded_from_count)
       SELECT id, ?, shift,
         station, division, unit,
         CASE WHEN substr(id, -1) = '1' AND id GLOB '[ABC]611' THEN 'CPT' ELSE rank_required END,
         CASE id
           WHEN 'A611' THEN 'Fireboat Officer' WHEN 'B611' THEN 'Fireboat Officer' WHEN 'C611' THEN 'Fireboat Officer'
           WHEN 'A612' THEN 'Fireboat Operator (Pilot)' WHEN 'B612' THEN 'Fireboat Operator (Pilot)' WHEN 'C612' THEN 'Fireboat Operator (Pilot)'
           WHEN 'A613' THEN 'Fireboat Engineer' WHEN 'B613' THEN 'Fireboat Engineer' WHEN 'C613' THEN 'Fireboat Engineer'
           ELSE position_name END,
         is_floating,
         is_vacant_by_design, is_excluded_from_count
       FROM positions WHERE template_version = ?`,
    ).bind(STATION_SIX_TARGET, STATION_SIX_SOURCE),
    c.env.DB.prepare(
      `INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name, is_floating, is_vacant_by_design, is_excluded_from_count)
       VALUES
         ('A614', ?, 'A', 'Station #6', 'Combat', 'Fire Boat', 'FF', 'Fireboat Deckhand', 0, 0, 0),
         ('A615', ?, 'A', 'Marine Float Pool', 'Combat', 'Marine Float Pool', 'FF', 'Marine Float Firefighter #1', 1, 0, 0),
         ('A616', ?, 'A', 'Marine Float Pool', 'Combat', 'Marine Float Pool', 'FF', 'Marine Float Firefighter #2', 1, 0, 0),
         ('B614', ?, 'B', 'Station #6', 'Combat', 'Fire Boat', 'FF', 'Fireboat Deckhand', 0, 0, 0),
         ('B615', ?, 'B', 'Marine Float Pool', 'Combat', 'Marine Float Pool', 'FF', 'Marine Float Firefighter #1', 1, 0, 0),
         ('B616', ?, 'B', 'Marine Float Pool', 'Combat', 'Marine Float Pool', 'FF', 'Marine Float Firefighter #2', 1, 0, 0),
         ('C614', ?, 'C', 'Station #6', 'Combat', 'Fire Boat', 'FF', 'Fireboat Deckhand', 0, 0, 0),
         ('C615', ?, 'C', 'Marine Float Pool', 'Combat', 'Marine Float Pool', 'FF', 'Marine Float Firefighter #1', 1, 0, 0),
         ('C616', ?, 'C', 'Marine Float Pool', 'Combat', 'Marine Float Pool', 'FF', 'Marine Float Firefighter #2', 1, 0, 0)`,
    ).bind(...Array(9).fill(STATION_SIX_TARGET)),
  ];
  statements.push(
    ...administrativeBindings.bindings.map((binding) =>
      c.env.DB.prepare(
        `INSERT INTO position_staffing_bindings (
             position_id, template_version, staffing_position_id, authoritative_source_ref, review_status, created_at
           ) VALUES (?, ?, ?, ?, 'approved', ?)`,
      ).bind(
        binding.positionId,
        STATION_SIX_TARGET,
        binding.staffingPositionId,
        binding.authoritativeSourceRef,
        now,
      ),
    ),
    c.env.DB.prepare(
      "DELETE FROM position_rules WHERE rule_book_version = ? AND position_id GLOB '[ABC]61[123]'",
    ).bind(STATION_SIX_RULE_BOOK),
    c.env.DB.prepare(
      'UPDATE position_rules SET template_version = ? WHERE rule_book_version = ?',
    ).bind(STATION_SIX_TARGET, STATION_SIX_RULE_BOOK),
  );
  for (const marineRuleChunk of [marineRuleRows.slice(0, 9), marineRuleRows.slice(9)]) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO position_rules (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain, notes)
         VALUES ${marineRuleChunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      ).bind(
        ...marineRuleChunk.flatMap(
          ([positionId, requiredCriteria, pointsPreference, tieBreakChain, notes]) => [
            STATION_SIX_RULE_BOOK,
            positionId,
            STATION_SIX_TARGET,
            requiredCriteria,
            pointsPreference,
            tieBreakChain,
            notes,
          ],
        ),
      ),
    );
  }
  statements.push(
    c.env.DB.prepare(
      'UPDATE rule_book_position_participation SET template_version = ? WHERE rule_book_version = ?',
    ).bind(STATION_SIX_TARGET, STATION_SIX_RULE_BOOK),
  );
  statements.push(
    c.env.DB.prepare(
      'UPDATE rule_books SET revision = revision + 1 WHERE version = ? AND status = ? AND revision = ?',
    ).bind(STATION_SIX_RULE_BOOK, 'draft', draft.revision),
    c.env.DB.prepare(
      `INSERT INTO audit_log (id, bid_session_id, seq, actor_type, actor_id, action, target_kind, target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at)
         SELECT ?, NULL, COALESCE(MAX(seq), 0) + 1, 'admin', ?, 'override_rule', 'position_template', ?, ?, ?, ?, NULL, NULL, ? FROM audit_log WHERE bid_session_id IS NULL`,
    ).bind(
      ulid(),
      c.get('claims').member_id,
      STATION_SIX_TARGET,
      JSON.stringify({
        source_template: STATION_SIX_SOURCE,
        source_positions: sourcePositions.length,
        source_rules: sourceRules.length,
      }),
      JSON.stringify({
        target_template: STATION_SIX_TARGET,
        positions: correctedPositionCount,
        rules: correctedRuleCount,
        station_six_roles_per_shift: 6,
      }),
      parsed.data.reason,
      now,
    ),
  );
  await c.env.DB.batch(statements);

  return c.json({
    template_version: STATION_SIX_TARGET,
    rule_book_version: STATION_SIX_RULE_BOOK,
    positions: correctedPositionCount,
    rules: correctedRuleCount,
    station_six_roles_per_shift: 6,
  });
});

export default router;

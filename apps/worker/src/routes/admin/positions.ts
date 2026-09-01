import { type JwtPayload, ReasonCodeSchema } from '@mbfd/shared';
import { type SQL, and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import {
  bidYears,
  positionRules,
  positionTemplates,
  positions,
  ruleBooks,
} from '../../db/schema.js';
import { writeAuditLog } from '../../lib/audit.js';
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
const MARINE_COMMON = [
  'Merchant Mariner Credential (MMC)',
  'IADRS Swim Evaluation',
  'Hazardous Materials Operations',
  'Open Water Diver Certified',
  'Fire Boat Operator Qualifications',
];

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

  await db.insert(positionTemplates).values({ version: destVersion, effectiveYear: destYear });

  if (srcPositions.length > 0) {
    await db
      .insert(positions)
      .values(srcPositions.map((p) => ({ ...p, templateVersion: destVersion })));
  }

  await writeAuditLog(db, {
    bidSessionId: null,
    actorType: 'admin',
    actorId: c.get('claims').sub ?? null,
    action: 'positions_clone',
    targetKind: 'position_template',
    targetId: destVersion,
    afterState: { srcVersion, destVersion, copied: srcPositions.length },
  });

  return c.json({ destVersion, destYear, copied: srcPositions.length });
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
  const [year, sourceTemplate, targetTemplate, draft, sourcePositions, sourceRules] =
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
    ]);
  if (
    year === undefined ||
    year.positionTemplateVersion !== null ||
    year.ruleBookVersion !== null
  ) {
    return c.json({ error: 'bid_year_already_designated' }, 409);
  }
  if (sourceTemplate === undefined) return c.json({ error: 'source_template_not_found' }, 404);
  if (targetTemplate !== undefined) return c.json({ error: 'target_template_already_exists' }, 409);
  if (draft === undefined || draft.status !== 'draft') {
    return c.json({ error: 'draft_rule_book_required' }, 409);
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

  const now = Math.floor(Date.now() / 1000);
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
      c.get('claims').sub,
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

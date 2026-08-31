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
  ruleBookPositionParticipation,
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

function isMarineProgramPosition(positionId: string): boolean {
  return /^[ABC]61[1-6]$/.test(positionId);
}

function correctedMarinePosition(
  source: typeof positions.$inferSelect,
): typeof positions.$inferInsert {
  const suffix = source.id.slice(-1);
  const definitions: Record<
    string,
    Pick<
      typeof positions.$inferInsert,
      'station' | 'unit' | 'rankRequired' | 'positionName' | 'isFloating'
    >
  > = {
    '1': {
      station: 'Station #6',
      unit: 'Fire Boat',
      rankRequired: 'CPT',
      positionName: 'Fireboat Officer',
      isFloating: false,
    },
    '2': {
      station: 'Station #6',
      unit: 'Fire Boat',
      rankRequired: 'FF',
      positionName: 'Fireboat Operator (Pilot)',
      isFloating: false,
    },
    '3': {
      station: 'Station #6',
      unit: 'Fire Boat',
      rankRequired: 'FF',
      positionName: 'Fireboat Engineer',
      isFloating: false,
    },
    '4': {
      station: 'Station #6',
      unit: 'Fire Boat',
      rankRequired: 'FF',
      positionName: 'Fireboat Deckhand',
      isFloating: false,
    },
    '5': {
      station: 'Marine Float Pool',
      unit: 'Marine Float Pool',
      rankRequired: 'FF',
      positionName: 'Marine Float Firefighter #1',
      isFloating: true,
    },
    '6': {
      station: 'Marine Float Pool',
      unit: 'Marine Float Pool',
      rankRequired: 'FF',
      positionName: 'Marine Float Firefighter #2',
      isFloating: true,
    },
  };
  const definition = definitions[suffix];
  if (definition === undefined) throw new Error(`unsupported Station 6 slot: ${source.id}`);
  return {
    ...source,
    templateVersion: STATION_SIX_TARGET,
    ...definition,
  };
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
  const [year, sourceTemplate, targetTemplate, draft, sourcePositions, sourceRules, participation] =
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
        .select()
        .from(ruleBookPositionParticipation)
        .where(eq(ruleBookPositionParticipation.ruleBookVersion, STATION_SIX_RULE_BOOK))
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
  const corrected = sourcePositions.flatMap((position) => {
    if (!/^[ABC]61[1-3]$/.test(position.id)) {
      return [{ ...position, templateVersion: STATION_SIX_TARGET }];
    }
    const base = correctedMarinePosition(position);
    const shift = position.shift as 'A' | 'B' | 'C';
    const extras = ['4', '5', '6'].map((slot) =>
      correctedMarinePosition({ ...position, id: `${shift}61${slot}` }),
    );
    return [base, ...extras];
  });
  const sourceRulesByPositionId = new Map(sourceRules.map((rule) => [rule.positionId, rule]));
  const targetRules = corrected
    .filter((position) => !position.isExcludedFromCount)
    .map((position) => {
      if (isMarineProgramPosition(position.id)) {
        return {
          position,
          requiredCriteria: correctedMarineRule(position.id).requiredCriteria,
          pointsPreference: correctedMarineRule(position.id).pointsPreference,
          tieBreakChain: correctedMarineRule(position.id).tieBreakChain,
          notes: correctedMarineRule(position.id).notes,
        };
      }
      const source = sourceRulesByPositionId.get(position.id);
      if (source === undefined) throw new Error(`missing source rule for ${position.id}`);
      return {
        position,
        requiredCriteria: source.requiredCriteriaJson,
        pointsPreference: source.pointsPreferenceJson,
        tieBreakChain: source.tieBreakChainJson,
        notes: source.notes,
      };
    });

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO position_templates (version, effective_year, notes) VALUES (?, ?, ?)',
    ).bind(STATION_SIX_TARGET, 2026, '2026 policy v3 and 2026-08-24 staffing reconciliation'),
  ];
  for (const position of corrected) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name, is_floating, is_vacant_by_design, is_excluded_from_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        position.id,
        STATION_SIX_TARGET,
        position.shift,
        position.station,
        position.division,
        position.unit,
        position.rankRequired,
        position.positionName,
        position.isFloating ? 1 : 0,
        position.isVacantByDesign ? 1 : 0,
        position.isExcludedFromCount ? 1 : 0,
      ),
    );
  }
  statements.push(
    c.env.DB.prepare('DELETE FROM position_rules WHERE rule_book_version = ?').bind(
      STATION_SIX_RULE_BOOK,
    ),
  );
  for (const {
    position,
    requiredCriteria,
    pointsPreference,
    tieBreakChain,
    notes,
  } of targetRules) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO position_rules (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        STATION_SIX_RULE_BOOK,
        position.id,
        STATION_SIX_TARGET,
        requiredCriteria,
        pointsPreference,
        tieBreakChain,
        notes,
      ),
    );
  }
  statements.push(
    c.env.DB.prepare(
      'DELETE FROM rule_book_position_participation WHERE rule_book_version = ?',
    ).bind(STATION_SIX_RULE_BOOK),
  );
  for (const record of participation) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO rule_book_position_participation (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        STATION_SIX_RULE_BOOK,
        record.positionId,
        STATION_SIX_TARGET,
        record.bidParticipation,
        record.authoritativeSourceRef,
        record.createdAt,
      ),
    );
  }
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
        positions: corrected.length,
        rules: targetRules.length,
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
    positions: corrected.length,
    rules: targetRules.length,
    station_six_roles_per_shift: 6,
  });
});

export default router;

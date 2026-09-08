import {
  AnnualRuleProfilesSchema,
  BidConfigurationSettingsSchema,
  BidConfigurationSettingsV2Schema,
  BidParticipationSchema,
  type JwtPayload,
} from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { freezeAnnualPlan } from '../../lib/annual-plan-freeze.js';
import {
  AnnualPlanExpectedSchema,
  mutateAnnualPlan,
  replayAnnualPlanMutation,
} from '../../lib/annual-plan-mutation.js';
import { loadAnnualPlanReview } from '../../lib/annual-plan-review.js';
import { createAnnualPlanSuccessor } from '../../lib/annual-plan-successor.js';
import { type AnnualRulePosition, compileAnnualRules } from '../../lib/annual-rule-compiler.js';
import { auditInsertStatement } from '../../lib/audit.js';
import {
  loadBidEligibilityEvidence,
  projectAnnualMemberEvidence,
} from '../../lib/bid-eligibility-evidence.js';
import {
  loadRuleBookCoverage,
  parseBidConfigurationSettings,
  prepareBidSessionPolicySnapshot,
} from '../../lib/bid-policy.js';
import { loadOfficialAnnualCompletion } from '../../lib/official-annual-completion.js';
import { isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { canonicalRosterShift } from './current-roster.js';
import { requireAdmin } from './middleware.js';
import { ORGANIZATION_AS_OF_SQL } from './organization.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };
const router = new Hono<Env>();
router.use('*', requireAdmin);
const StartSchema = z
  .object({
    year: z.number().int().min(2024).max(2100),
    effective_on: z.string().refine(isIsoCalendarDate),
    credential_evaluation_on: z.string().refine(isIsoCalendarDate),
    expected_duration_days: z.number().int().min(1).max(7),
    turn_timer_seconds: z.number().int().min(30).max(600),
    source_session_id: z.string().min(1).optional(),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

router.get('/', async (c) => {
  const plans =
    await c.env.DB.prepare(`SELECT y.year, y.status, y.rule_book_version AS ruleBookVersion,
    y.position_template_version AS templateVersion, y.configuration_revision AS configurationRevision,
    p.effective_on AS effectiveOn, p.source_session_id AS sourceSessionId, p.revision AS reviewRevision,
    b.status AS ruleBookStatus FROM bid_years y LEFT JOIN annual_plan_reviews p ON p.bid_year = y.year
    LEFT JOIN rule_books b ON b.version = y.rule_book_version ORDER BY y.year DESC`).all();
  return c.json({ plans: plans.results });
});

router.get('/official-sources', async (c) => {
  const candidates = await c.env.DB.prepare(`SELECT s.id FROM bid_sessions s
    JOIN canonical_bid_session_state state ON state.bid_session_id = s.id
    WHERE s.is_mock = 0 ORDER BY s.bid_year DESC, state.updated_at DESC, s.id`).all<{
    id: string;
  }>();
  const sources: { sessionId: string; year: number; completedAtMs: number }[] = [];
  for (const candidate of candidates.results) {
    const official = await loadOfficialAnnualCompletion(c.env.DB, candidate.id);
    if (official.ok)
      sources.push({
        sessionId: candidate.id,
        year: official.completion.bidYear,
        completedAtMs: official.completion.completion.completedAtMs,
      });
  }
  return c.json({
    sources,
    notice:
      sources.length === 0
        ? 'No verified official completion is available. Start a blank plan or resume an existing draft.'
        : null,
  });
});

router.post('/', requireStepUpAuth(), async (c) => {
  const parsed = StartSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const request = JSON.stringify(body);
  const receipt = await c.env.DB.prepare(
    'SELECT * FROM annual_plan_receipts WHERE idempotency_key = ?',
  )
    .bind(key)
    .first<{ actor_subject: string; request_json: string; response_json: string }>();
  if (receipt) {
    if (receipt.actor_subject !== actor || receipt.request_json !== request)
      return c.json({ error: 'idempotency_key_reused' }, 409);
    return c.json({ ...JSON.parse(receipt.response_json), replayed: true });
  }
  if (Number(body.effective_on.slice(0, 4)) !== body.year)
    return c.json({ error: 'effective_year_mismatch' }, 400);
  const existing = await c.env.DB.prepare(
    'SELECT rule_book_version, status FROM bid_years WHERE year = ?',
  )
    .bind(body.year)
    .first<{ rule_book_version: string | null; status: string }>();
  if (existing && (existing.rule_book_version !== null || existing.status !== 'configuring'))
    return c.json({ error: 'annual_plan_exists_resume_required' }, 409);
  const official = body.source_session_id
    ? await loadOfficialAnnualCompletion(c.env.DB, body.source_session_id)
    : null;
  if (official && !official.ok)
    return c.json({ error: 'official_source_unavailable', detail: official.error }, 409);
  if (official?.ok && official.completion.bidYear >= body.year)
    return c.json({ error: 'source_year_must_precede_target' }, 400);
  if (
    official?.ok &&
    official.snapshot.ruleBookMaterial.positions.some(
      (p) =>
        p.division === undefined || p.isFloating === undefined || p.isVacantByDesign === undefined,
    )
  )
    return c.json(
      {
        error: 'historical_topology_details_require_review',
        detail:
          'The historical snapshot lacks division or position characteristics. Use a blank plan with reviewed source facts.',
      },
      409,
    );
  // A generated internal version is collision-resistant and never a manual admin field.
  const version = `${body.year}.${Date.now()}`;
  const settings = BidConfigurationSettingsV2Schema.parse({
    v: 2,
    credentialEvaluationOn: body.credential_evaluation_on,
    personnelEvaluationOn: body.effective_on,
    expectedDurationDays: body.expected_duration_days,
    turnTimerSeconds: body.turn_timer_seconds,
  });
  const response = {
    year: body.year,
    ruleBookVersion: version,
    templateVersion: version,
    lifecycle: 'DRAFT',
    sourceSessionId: body.source_session_id ?? null,
  };
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO annual_plan_receipts (idempotency_key, actor_subject, request_json, response_json, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(key, actor, request, JSON.stringify(response), Date.now()),
    c.env.DB.prepare(
      'INSERT INTO position_templates (version, effective_year, notes) VALUES (?, ?, ?)',
    ).bind(version, body.year, 'Annual plan; inherited material requires review'),
    c.env.DB.prepare(
      "INSERT INTO rule_books (version, effective_year, status, revision, notes) VALUES (?, ?, 'draft', 0, ?)",
    ).bind(version, body.year, 'Annual plan; inherited material requires review'),
    c.env.DB.prepare(`INSERT INTO bid_years (year, status, rule_book_version, position_template_version, config_json, configuration_revision)
      VALUES (?, 'configuring', ?, ?, ?, 1)
      ON CONFLICT(year) DO UPDATE SET rule_book_version = excluded.rule_book_version,
        position_template_version = excluded.position_template_version, config_json = excluded.config_json,
        configuration_revision = bid_years.configuration_revision + 1
      WHERE bid_years.status = 'configuring' AND bid_years.rule_book_version IS NULL
        AND NOT EXISTS (SELECT 1 FROM bid_sessions WHERE bid_year = bid_years.year AND is_mock = 0)`).bind(
      body.year,
      version,
      version,
      JSON.stringify(settings),
    ),
    c.env.DB.prepare(`INSERT INTO annual_plan_reviews (bid_year, effective_on, source_session_id, source_policy_text, created_at)
      SELECT ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM bid_years WHERE year = ? AND rule_book_version = ?) THEN ? ELSE NULL END`).bind(
      body.year,
      body.effective_on,
      body.source_session_id ?? null,
      official?.ok ? (official.snapshot.annualPolicyEvidence?.policyText ?? null) : null,
      body.year,
      version,
      Date.now(),
    ),
  ];
  if (official?.ok) {
    for (const p of official.snapshot.ruleBookMaterial.positions) {
      statements.push(
        c.env.DB.prepare(`INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name, is_floating, is_vacant_by_design, is_excluded_from_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          p.id,
          version,
          p.shift,
          p.station,
          p.division ?? null,
          p.unit,
          p.rankRequired,
          p.positionName,
          Number(p.isFloating),
          Number(p.isVacantByDesign),
          Number(p.isExcludedFromCount),
        ),
      );
      statements.push(
        c.env.DB.prepare(`INSERT INTO rule_book_position_participation
        (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(
          version,
          p.id,
          version,
          p.bidParticipation,
          `inherited-unreviewed:${body.source_session_id}`,
          Date.now(),
        ),
      );
    }
    for (const r of official.snapshot.ruleBookMaterial.rules) {
      statements.push(
        c.env.DB.prepare(`INSERT INTO position_rules (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(
          version,
          r.positionId,
          version,
          r.requiredCriteriaJson,
          r.pointsPreferenceJson,
          r.tieBreakChainJson,
        ),
      );
    }
    // Operational grants, participants, qualification assumptions, bindings and
    // session state are deliberately not copied as approved future facts.
  }
  statements.push(
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'bid_configuration_set',
      targetKind: 'bid_year',
      targetId: String(body.year),
      reason: body.reason,
      afterState: response,
      clientMeta: { annual_plan_key: key },
    }),
  );
  try {
    await c.env.DB.batch(statements);
  } catch {
    return c.json({ error: 'annual_plan_changed_retry_or_resume' }, 409);
  }
  return c.json({ ...response, replayed: false }, 201);
});

router.post('/:year/adopt', requireStepUpAuth(), async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const parsed = StartSchema.omit({ year: true, source_session_id: true })
    .merge(AnnualPlanExpectedSchema)
    .extend({ accept_existing_draft: z.literal(true) })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  if (Number(body.effective_on.slice(0, 4)) !== year)
    return c.json({ error: 'effective_year_mismatch' }, 400);
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const intent = {
    year,
    operation: 'adopt-existing-draft',
    request: body,
    key,
    actorSubject: actor,
  };
  const prior = await replayAnnualPlanMutation(c.env.DB, intent);
  if (prior)
    return prior.ok
      ? c.json({ ...prior.response, replayed: true })
      : c.json({ error: prior.error }, 409);
  const existing = await c.env.DB.prepare(`SELECT y.rule_book_version AS book,
    y.position_template_version AS template,y.config_json AS settingsJson,
    y.annual_policy_document_id AS policyId FROM bid_years y WHERE y.year=?`)
    .bind(year)
    .first<{
      book: string | null;
      template: string | null;
      settingsJson: string | null;
      policyId: string | null;
    }>();
  if (!existing?.book || !existing.template)
    return c.json({ error: 'designated_draft_required' }, 409);
  const oldSettings = parseBidConfigurationSettings(existing.settingsJson);
  if (!oldSettings) return c.json({ error: 'existing_configuration_requires_repair' }, 409);
  const previousParticipation = await c.env.DB.prepare(
    'SELECT position_id,template_version,bid_participation,authoritative_source_ref FROM rule_book_position_participation WHERE rule_book_version=? ORDER BY position_id',
  )
    .bind(existing.book)
    .all();
  const settings = BidConfigurationSettingsSchema.parse({
    ...oldSettings,
    v: oldSettings.v === 3 ? 3 : 2,
    personnelEvaluationOn: body.effective_on,
    credentialEvaluationOn: body.credential_evaluation_on,
    expectedDurationDays: body.expected_duration_days,
    turnTimerSeconds: body.turn_timer_seconds,
  });
  const response = {
    year,
    ruleBookVersion: existing.book,
    templateVersion: existing.template,
    lifecycle: 'DRAFT',
    effectiveOn: body.effective_on,
  };
  const request = JSON.stringify({ year, operation: intent.operation, body });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO annual_plan_receipts (idempotency_key,actor_subject,request_json,response_json,created_at)
        SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM bid_years y JOIN rule_books b ON b.version=y.rule_book_version
          WHERE y.year=? AND y.status='configuring' AND b.status='draft' AND b.version=? AND b.revision=?
            AND y.position_template_version=? AND y.configuration_revision=?
            AND (SELECT revision FROM annual_source_revision WHERE id=1)=?
            AND NOT EXISTS(SELECT 1 FROM annual_plan_reviews p WHERE p.bid_year=y.year)
            AND NOT EXISTS(SELECT 1 FROM bid_sessions s WHERE s.bid_year=y.year AND s.is_mock=0)
            AND NOT EXISTS(SELECT 1 FROM bid_years other WHERE other.year<>y.year AND (other.position_template_version=y.position_template_version OR other.rule_book_version=y.rule_book_version))
            AND NOT EXISTS(SELECT 1 FROM position_rules rules WHERE rules.template_version=y.position_template_version AND rules.rule_book_version<>y.rule_book_version)
            AND NOT EXISTS(SELECT 1 FROM annual_bid_policy_documents document WHERE document.id=y.annual_policy_document_id AND document.status<>'DRAFT'))
          THEN ? ELSE NULL END,?,?,?`).bind(
        key,
        year,
        existing.book,
        body.expected_rule_revision,
        existing.template,
        body.expected_configuration_revision,
        body.expected_source_revision,
        actor,
        request,
        JSON.stringify(response),
        Date.now(),
      ),
      c.env.DB.prepare(`INSERT INTO annual_plan_reviews (bid_year,effective_on,source_policy_text,created_at)
        VALUES (?,?,(SELECT policy_text FROM annual_bid_policy_documents WHERE id=?),?)`).bind(
        year,
        body.effective_on,
        existing.policyId,
        Date.now(),
      ),
      c.env.DB.prepare(
        'UPDATE bid_years SET config_json=?,configuration_revision=configuration_revision+1 WHERE year=?',
      ).bind(JSON.stringify(settings), year),
      // Existing labels and participation remain inspectable but are not treated
      // as current annual approval merely because a legacy draft was adopted.
      c.env.DB.prepare(
        'UPDATE rule_book_position_participation SET authoritative_source_ref=? WHERE rule_book_version=?',
      ).bind(`inherited-unreviewed:adopted-year:${year}`, existing.book),
      auditInsertStatement(c.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'bid_configuration_set',
        targetKind: 'bid_year',
        targetId: String(year),
        reason: body.reason,
        beforeState: {
          ruleBookVersion: existing.book,
          templateVersion: existing.template,
          settings: oldSettings,
          annualPolicyDocumentId: existing.policyId,
          participation: previousParticipation.results,
        },
        afterState: { ...response, settings },
        clientMeta: { annual_plan_key: key, operation: intent.operation },
      }),
    ]);
  } catch {
    const replay = await replayAnnualPlanMutation(c.env.DB, intent);
    if (replay)
      return replay.ok
        ? c.json({ ...replay.response, replayed: true })
        : c.json({ error: replay.error }, 409);
    return c.json(
      { error: 'adoption_requires_current_exclusive_unpublished_draft_without_real_session' },
      409,
    );
  }
  return c.json({ ...response, replayed: false });
});

router.get('/:year/participants', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const plan = await c.env.DB.prepare(
    'SELECT y.config_json,p.effective_on FROM bid_years y JOIN annual_plan_reviews p ON p.bid_year=y.year WHERE y.year=?',
  )
    .bind(year)
    .first<{ config_json: string; effective_on: string }>();
  const settings = plan ? parseBidConfigurationSettings(plan.config_json) : null;
  if (!plan || !settings || settings.v === 1)
    return c.json({ error: 'annual_dates_require_review' }, 409);
  const before = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  const evidence = projectAnnualMemberEvidence(
    await loadBidEligibilityEvidence(getDb(c.env.DB)),
    plan.effective_on,
    settings.credentialEvaluationOn,
  );
  if (!evidence.ok) return c.json({ error: evidence.error }, 409);
  const after = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  if (before?.revision !== after?.revision)
    return c.json({ error: 'annual_source_changed_retry' }, 409);
  return c.json({
    year,
    personnelOn: plan.effective_on,
    qualificationEvaluationOn: settings.credentialEvaluationOn,
    sourceRevision: after?.revision,
    participation: 'REQUIRES_ANNUAL_POLICY_REVIEW',
    members: evidence.members,
  });
});

router.get('/:year/seats', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const rows =
    await c.env.DB.prepare(`SELECT p.id,p.shift,p.station,p.unit,p.rank_required AS rank,p.position_name AS name,
    p.is_floating AS isFloating,p.is_vacant_by_design AS isVacantByDesign,p.is_excluded_from_count AS isExcludedFromCount,
    COALESCE(part.bid_participation,'BIDDABLE') AS participation,part.authoritative_source_ref AS participationSource,
    bind.staffing_position_id AS staffingPositionId,bind.review_status AS bindingStatus,bind.authoritative_source_ref AS bindingSource
    FROM bid_years y JOIN annual_plan_reviews review ON review.bid_year=y.year JOIN positions p ON p.template_version=y.position_template_version
    LEFT JOIN rule_book_position_participation part ON part.rule_book_version=y.rule_book_version AND part.position_id=p.id AND part.template_version=p.template_version
    LEFT JOIN position_staffing_bindings bind ON bind.position_id=p.id AND bind.template_version=p.template_version
    WHERE y.year=? ORDER BY p.shift,p.station,p.unit,p.id`)
      .bind(year)
      .all();
  c.header('Cache-Control', 'private, no-store');
  return c.json({ seats: rows.results });
});

router.post('/:year/seats', requireStepUpAuth(), async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const parsed = AnnualPlanExpectedSchema.extend({
    seats: z
      .array(
        z
          .object({
            existing_position_id: z.string().min(1).optional(),
            staffing_position_id: z.string().min(1),
            bid_participation: BidParticipationSchema,
            is_floating: z.boolean(),
            is_vacant_by_design: z.boolean(),
            is_excluded_from_count: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    evidence_ref: z.string().trim().min(4).max(500),
    reason: z.string().trim().min(4).max(500),
  })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  if (new Set(body.seats.map((s) => s.staffing_position_id)).size !== body.seats.length)
    return c.json({ error: 'duplicate_seat_selection' }, 400);
  const existingIds = body.seats.flatMap((s) =>
    s.existing_position_id ? [s.existing_position_id] : [],
  );
  if (new Set(existingIds).size !== existingIds.length)
    return c.json({ error: 'duplicate_position_selection' }, 400);
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const prior = await replayAnnualPlanMutation(c.env.DB, {
    year,
    key,
    actorSubject: actor,
    operation: 'add-reviewed-seats',
    request: body,
  });
  if (prior)
    return prior.ok
      ? c.json({ ...prior.response, replayed: true })
      : c.json({ error: prior.error }, 409);
  const plan =
    await c.env.DB.prepare(`SELECT y.position_template_version AS template,y.rule_book_version AS book,p.effective_on AS effectiveOn
    FROM bid_years y JOIN annual_plan_reviews p ON p.bid_year=y.year WHERE y.year=?`)
      .bind(year)
      .first<{ template: string; book: string; effectiveOn: string }>();
  if (!plan) return c.json({ error: 'managed_annual_plan_required' }, 409);
  const sourceRevision = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  if (sourceRevision?.revision !== body.expected_source_revision)
    return c.json({ error: 'annual_source_changed' }, 409);
  const [seats, units, bindings, positions] = await Promise.all([
    c.env.DB.prepare(`SELECT seat.*,link.organization_unit_id FROM staffing_positions seat LEFT JOIN organization_staffing_links link ON link.staffing_position_id=seat.id
      AND link.revision=(SELECT revision FROM organization_staffing_links WHERE staffing_position_id=seat.id AND effective_on<=? ORDER BY effective_on DESC,revision DESC LIMIT 1)
      WHERE seat.review_status IN ('approved','retired') AND (seat.active_from IS NULL OR seat.active_from<=?) AND (seat.active_to IS NULL OR seat.active_to>=?)`)
      .bind(plan.effectiveOn, plan.effectiveOn, plan.effectiveOn)
      .all<{
        id: string;
        division: string | null;
        shift: string | null;
        unit: string | null;
        position_name: string | null;
        applicable_rank: string | null;
        organization_unit_id: string | null;
      }>(),
    c.env.DB.prepare(ORGANIZATION_AS_OF_SQL)
      .bind(plan.effectiveOn)
      .all<{ id: string; kind: string; name: string; parentId: string | null; status: string }>(),
    c.env.DB.prepare(
      'SELECT staffing_position_id,position_id FROM position_staffing_bindings WHERE template_version=?',
    )
      .bind(plan.template)
      .all<{ staffing_position_id: string; position_id: string }>(),
    c.env.DB.prepare('SELECT * FROM positions WHERE template_version=?')
      .bind(plan.template)
      .all<{ id: string } & Record<string, unknown>>(),
  ]);
  const seatById = new Map(seats.results.map((s) => [s.id, s]));
  const unitById = new Map(units.results.map((u) => [u.id, u]));
  const alreadyBound = new Map(
    bindings.results.map((b) => [b.staffing_position_id, b.position_id]),
  );
  const positionById = new Map(positions.results.map((p) => [p.id, p]));
  const statements: D1PreparedStatement[] = [];
  const added: { positionId: string; staffingPositionId: string; participation: string }[] = [];
  for (const selection of body.seats) {
    if (selection.existing_position_id && !positionById.has(selection.existing_position_id))
      return c.json({ error: 'annual_position_not_found' }, 409);
    if (
      alreadyBound.has(selection.staffing_position_id) &&
      alreadyBound.get(selection.staffing_position_id) !== selection.existing_position_id
    )
      return c.json({ error: 'seat_already_bound_to_annual_plan' }, 409);
    const seat = seatById.get(selection.staffing_position_id);
    const unit = seat?.organization_unit_id ? unitById.get(seat.organization_unit_id) : null;
    const parent = unit?.parentId ? unitById.get(unit.parentId) : null;
    const station = unit?.kind === 'APPARATUS' ? parent : unit;
    const shift = canonicalRosterShift(seat?.shift ?? null);
    if (
      !seat ||
      !unit ||
      unit.status !== 'active' ||
      !station ||
      station.status !== 'active' ||
      !shift ||
      !['A', 'B', 'C', 'D'].includes(shift) ||
      !seat.division?.trim() ||
      !seat.position_name?.trim() ||
      !seat.applicable_rank ||
      !['FF', 'LT', 'CPT', 'DC'].includes(seat.applicable_rank) ||
      (!seat.unit?.trim() && unit.kind !== 'APPARATUS')
    )
      return c.json(
        {
          error: 'seat_organization_or_required_facts_need_review',
          staffingPositionId: selection.staffing_position_id,
        },
        409,
      );
    const id = selection.existing_position_id ?? `${shift}-${ulid()}`;
    const values = [
      shift,
      station.name,
      seat.division,
      unit.kind === 'APPARATUS' ? unit.name : seat.unit,
      seat.applicable_rank,
      seat.position_name,
      Number(selection.is_floating),
      Number(selection.is_vacant_by_design),
      Number(selection.is_excluded_from_count),
    ];
    statements.push(
      selection.existing_position_id
        ? c.env.DB.prepare(
            'UPDATE positions SET shift=?,station=?,division=?,unit=?,rank_required=?,position_name=?,is_floating=?,is_vacant_by_design=?,is_excluded_from_count=? WHERE id=? AND template_version=?',
          ).bind(...values, id, plan.template)
        : c.env.DB.prepare(
            'INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name,is_floating,is_vacant_by_design,is_excluded_from_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          ).bind(id, plan.template, ...values),
    );
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO position_staffing_bindings (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at) VALUES (?,?,?,?,'approved',?) ON CONFLICT(position_id,template_version) DO UPDATE SET staffing_position_id=excluded.staffing_position_id,authoritative_source_ref=excluded.authoritative_source_ref,review_status='approved',created_at=excluded.created_at`,
      ).bind(id, plan.template, seat.id, body.evidence_ref, Date.now()),
    );
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(rule_book_version,position_id) DO UPDATE SET bid_participation=excluded.bid_participation,authoritative_source_ref=excluded.authoritative_source_ref,created_at=excluded.created_at',
      ).bind(
        plan.book,
        id,
        plan.template,
        selection.bid_participation,
        body.evidence_ref,
        Date.now(),
      ),
    );
    added.push({
      positionId: id,
      staffingPositionId: seat.id,
      participation: selection.bid_participation,
    });
  }
  statements.push(
    c.env.DB.prepare('UPDATE rule_books SET revision=revision+1 WHERE version=?').bind(plan.book),
  );
  const result = await mutateAnnualPlan(c.env.DB, {
    year,
    key,
    actorSubject: actor,
    actorId: c.get('claims').member_id,
    body,
    operation: 'add-reviewed-seats',
    request: body,
    response: {
      added,
      reviewedExisting: existingIds.map((id) => ({ before: positionById.get(id), positionId: id })),
      ruleBookRevision: body.expected_rule_revision + 1,
    },
    reason: body.reason,
    statements,
  });
  return result.ok
    ? c.json({ ...result.response, replayed: result.replayed }, 201)
    : c.json({ error: result.error }, 409);
});

router.post('/:year/seats/remove', requireStepUpAuth(), async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const parsed = AnnualPlanExpectedSchema.extend({
    position_ids: z.array(z.string().min(1)).min(1).max(500),
    confirm_remove: z.literal(true),
    evidence_ref: z.string().trim().min(4).max(500),
    reason: z.string().trim().min(4).max(500),
  })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  if (new Set(body.position_ids).size !== body.position_ids.length)
    return c.json({ error: 'duplicate_position_selection' }, 400);
  const key = c.req.header('Idempotency-Key');
  if (!key || key.trim() !== key || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const identity = {
    year,
    key,
    actorSubject: actor,
    operation: 'remove-reviewed-seats',
    request: body,
  };
  const prior = await replayAnnualPlanMutation(c.env.DB, identity);
  if (prior)
    return prior.ok
      ? c.json({ ...prior.response, replayed: true })
      : c.json({ error: prior.error }, 409);
  const plan = await c.env.DB.prepare(
    'SELECT y.position_template_version AS template,y.rule_book_version AS book FROM bid_years y JOIN annual_plan_reviews p ON p.bid_year=y.year WHERE y.year=?',
  )
    .bind(year)
    .first<{ template: string; book: string }>();
  if (!plan) return c.json({ error: 'managed_annual_plan_required' }, 409);
  const positions = await c.env.DB.prepare('SELECT * FROM positions WHERE template_version=?')
    .bind(plan.template)
    .all<{ id: string } & Record<string, unknown>>();
  const byId = new Map(positions.results.map((p) => [p.id, p]));
  if (body.position_ids.some((id) => !byId.has(id)))
    return c.json({ error: 'annual_position_not_found' }, 409);
  const statements = body.position_ids.flatMap((id) => [
    c.env.DB.prepare(
      'DELETE FROM position_rules WHERE rule_book_version=? AND position_id=? AND template_version=?',
    ).bind(plan.book, id, plan.template),
    c.env.DB.prepare(
      'DELETE FROM rule_book_position_participation WHERE rule_book_version=? AND position_id=? AND template_version=?',
    ).bind(plan.book, id, plan.template),
    c.env.DB.prepare(
      'DELETE FROM position_staffing_bindings WHERE position_id=? AND template_version=?',
    ).bind(id, plan.template),
    c.env.DB.prepare('DELETE FROM positions WHERE id=? AND template_version=?').bind(
      id,
      plan.template,
    ),
  ]);
  statements.push(
    c.env.DB.prepare('UPDATE rule_books SET revision=revision+1 WHERE version=?').bind(plan.book),
  );
  const result = await mutateAnnualPlan(c.env.DB, {
    ...identity,
    actorId: c.get('claims').member_id,
    body,
    response: {
      removed: body.position_ids.map((id) => byId.get(id)),
      ruleBookRevision: body.expected_rule_revision + 1,
    },
    reason: body.reason,
    statements,
  });
  return result.ok
    ? c.json({ ...result.response, replayed: result.replayed })
    : c.json({ error: result.error }, 409);
});

router.get('/:year/review', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const baseline = c.req.query('baseline') ?? 'official';
  if (baseline !== 'official' && baseline !== 'last_review')
    return c.json({ error: 'invalid_comparison_baseline' }, 400);
  const review = await loadAnnualPlanReview(c.env.DB, year, baseline);
  c.header('Cache-Control', 'private, no-store');
  return review.ok ? c.json(review) : c.json({ error: review.error }, 409);
});

router.post('/:year/review', requireStepUpAuth(), async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const parsed = AnnualPlanExpectedSchema.extend({
    reason: z.string().trim().min(4).max(500),
    accept_review: z.literal(true),
  })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const intent = {
    year,
    key,
    operation: 'save-source-review',
    request: parsed.data,
    actorSubject: String(c.get('claims').sub),
  };
  const prior = await replayAnnualPlanMutation(c.env.DB, intent);
  if (prior)
    return prior.ok
      ? c.json({ ...prior.response, replayed: true })
      : c.json({ error: prior.error }, 409);
  const prepared = await prepareBidSessionPolicySnapshot(getDb(c.env.DB), year, Date.now(), 'mock');
  if (!prepared.ok)
    return c.json({ error: 'comparable_source_preparation_required', detail: prepared.code }, 409);
  const now = Date.now();
  const id = ulid();
  const result = await mutateAnnualPlan(c.env.DB, {
    ...intent,
    body: parsed.data,
    reason: parsed.data.reason,
    actorId: c.get('claims').member_id,
    response: {
      checkpointId: id,
      year,
      reviewedAt: now,
      sourceRevision: parsed.data.expected_source_revision,
    },
    statements: [
      c.env.DB.prepare(`INSERT INTO annual_source_review_checkpoints
      (id,bid_year,rule_revision,configuration_revision,source_revision,snapshot_json,actor_subject,reason,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(
        id,
        year,
        parsed.data.expected_rule_revision,
        parsed.data.expected_configuration_revision,
        parsed.data.expected_source_revision,
        JSON.stringify(prepared.snapshot),
        intent.actorSubject,
        parsed.data.reason,
        now,
      ),
    ],
  });
  return result.ok
    ? c.json({ ...result.response, replayed: result.replayed })
    : c.json({ error: result.error }, 409);
});

router.post('/:year/freeze', requireStepUpAuth(), async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const parsed = AnnualPlanExpectedSchema.extend({
    mock_session_id: z.string().min(1).max(160),
    reason: z.string().trim().min(4).max(500),
    accept_review: z.literal(true),
  })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const result = await freezeAnnualPlan(c.env.DB, {
    year,
    key,
    actorSubject: String(c.get('claims').sub),
    actorId: c.get('claims').member_id,
    body: parsed.data,
  });
  return result.ok
    ? c.json({ ...result.response, replayed: result.replayed })
    : c.json(
        { error: result.error, ...('blockers' in result ? { blockers: result.blockers } : {}) },
        409,
      );
});

router.get('/:year/profiles', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT revision,rule_revision,profiles_json,compiled_json FROM annual_rule_profile_revisions WHERE bid_year=? ORDER BY revision DESC LIMIT 1',
  )
    .bind(Number(c.req.param('year')))
    .first<{
      revision: number;
      rule_revision: number;
      profiles_json: string;
      compiled_json: string;
    }>();
  return c.json(
    row
      ? {
          revision: row.revision,
          ruleRevision: row.rule_revision,
          profiles: JSON.parse(row.profiles_json),
          compiled: JSON.parse(row.compiled_json),
        }
      : { revision: 0, ruleRevision: null, profiles: [], compiled: [] },
  );
});

router.post('/:year/profiles', requireStepUpAuth(), async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const parsed = AnnualPlanExpectedSchema.extend({
    profiles: AnnualRuleProfilesSchema,
    preview: z.boolean(),
    reason: z.string().trim().min(4).max(500),
  })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  if (!body.preview && (!key || key !== key.trim() || key.length > 256))
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  if (!body.preview && key) {
    const prior = await replayAnnualPlanMutation(c.env.DB, {
      year,
      key,
      actorSubject: actor,
      operation: 'compile-rule-profiles',
      request: body,
    });
    if (prior)
      return prior.ok
        ? c.json({ ...prior.response, replayed: true })
        : c.json({ error: prior.error }, 409);
  }
  const plan =
    await c.env.DB.prepare(`SELECT y.position_template_version AS template,y.rule_book_version AS book,y.configuration_revision AS configRevision,b.revision AS ruleRevision,
    (SELECT revision FROM annual_source_revision WHERE id=1) AS sourceRevision
    FROM bid_years y JOIN annual_plan_reviews p ON p.bid_year=y.year JOIN rule_books b ON b.version=y.rule_book_version WHERE y.year=? AND y.status='configuring' AND b.status='draft'`)
      .bind(year)
      .first<{
        template: string;
        book: string;
        configRevision: number;
        ruleRevision: number;
        sourceRevision: number;
      }>();
  if (!plan) return c.json({ error: 'managed_draft_required' }, 409);
  if (
    plan.configRevision !== body.expected_configuration_revision ||
    plan.ruleRevision !== body.expected_rule_revision ||
    plan.sourceRevision !== body.expected_source_revision
  )
    return c.json({ error: 'annual_plan_or_source_changed' }, 409);
  const [positions, catalog, serviceTypes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.id,p.station,p.shift,p.rank_required AS rank FROM positions p LEFT JOIN rule_book_position_participation part ON part.position_id=p.id AND part.template_version=p.template_version AND part.rule_book_version=? WHERE p.template_version=? AND COALESCE(part.bid_participation,'BIDDABLE')='BIDDABLE' ORDER BY p.id`,
    )
      .bind(plan.book, plan.template)
      .all<AnnualRulePosition>(),
    c.env.DB.prepare(
      'SELECT c.name,m.retired_on FROM credentials c LEFT JOIN credential_catalog_metadata m ON m.credential_id=c.id',
    ).all<{ name: string; retired_on: string | null }>(),
    c.env.DB.prepare('SELECT id FROM service_credit_types').all<{ id: string }>(),
  ]);
  if (!positions.results.length) return c.json({ error: 'biddable_positions_required' }, 409);
  const active = new Set(catalog.results.filter((c) => !c.retired_on).map((c) => c.name));
  const unknown = new Set<string>();
  const knownServiceCodes = new Set(serviceTypes.results.map((t) => t.id));
  const unknownServices = new Set(
    body.profiles
      .flatMap((p) => p.requirements.service ?? [])
      .filter((r) => !knownServiceCodes.has(r.serviceCode))
      .map((r) => r.serviceCode),
  );
  if (unknownServices.size)
    return c.json(
      { error: 'service_categories_require_review', codes: [...unknownServices].sort() },
      409,
    );
  for (const profile of body.profiles) {
    const tokens = [...profile.requirements.credentials];
    for (const obligation of profile.requirements.postAward ?? [])
      tokens.push(obligation.credential);
    for (const group of profile.requirements.anyOfCredentials ?? []) tokens.push(...group);
    if (profile.scoring)
      for (const channel of [profile.scoring.total, profile.scoring.so, profile.scoring.mo])
        for (const group of channel)
          for (const item of group.items)
            tokens.push(item.credential, ...item.alternatives, ...item.requiresAll);
    for (const token of tokens) if (!active.has(token)) unknown.add(token);
  }
  if (unknown.size)
    return c.json({ error: 'credential_tokens_require_review', tokens: [...unknown].sort() }, 409);
  const result = compileAnnualRules(positions.results, body.profiles, plan.book);
  if (!result.ok) return c.json({ error: 'profile_conflicts', conflicts: result.conflicts }, 409);
  if (body.preview)
    return c.json({
      ...result,
      ruleRevision: plan.ruleRevision,
      sourceRevision: plan.sourceRevision,
      configurationRevision: plan.configRevision,
    });
  const revision = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(revision),0)+1 AS next FROM annual_rule_profile_revisions WHERE bid_year=?',
  )
    .bind(year)
    .first<{ next: number }>();
  const statements: D1PreparedStatement[] = [];
  const duplicates = await c.env.DB.prepare(
    'SELECT position_id FROM position_rules WHERE rule_book_version=? GROUP BY position_id,template_version HAVING COUNT(*)>1',
  )
    .bind(plan.book)
    .all();
  if (duplicates.results.length)
    return c.json({ error: 'duplicate_existing_rules_require_review' }, 409);
  for (const entry of result.compiled) {
    const required = JSON.stringify(entry.rule.requiredCriteria);
    const points = JSON.stringify(entry.rule.pointsPreference);
    const priorities = JSON.stringify(entry.rule.tieBreakChain);
    statements.push(
      c.env.DB.prepare(
        'UPDATE position_rules SET required_criteria=?,points_preference=?,tie_break_chain=? WHERE rule_book_version=? AND position_id=? AND template_version=?',
      ).bind(required, points, priorities, plan.book, entry.rule.positionId, plan.template),
    );
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM position_rules WHERE rule_book_version=? AND position_id=? AND template_version=?)',
      ).bind(
        plan.book,
        entry.rule.positionId,
        plan.template,
        required,
        points,
        priorities,
        plan.book,
        entry.rule.positionId,
        plan.template,
      ),
    );
  }
  statements.push(
    c.env.DB.prepare('UPDATE rule_books SET revision=revision+1 WHERE version=?').bind(plan.book),
  );
  statements.push(
    c.env.DB.prepare(
      'INSERT INTO annual_rule_profile_revisions (bid_year,revision,rule_revision,profiles_json,compiled_json,actor_subject,reason,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).bind(
      year,
      revision?.next ?? 1,
      plan.ruleRevision + 1,
      JSON.stringify(body.profiles),
      JSON.stringify(result.compiled),
      actor,
      body.reason,
      Date.now(),
    ),
  );
  const saved = await mutateAnnualPlan(c.env.DB, {
    year,
    key: key ?? '',
    actorSubject: actor,
    actorId: c.get('claims').member_id,
    body,
    operation: 'compile-rule-profiles',
    request: body,
    response: {
      revision: revision?.next ?? 1,
      ruleBookRevision: plan.ruleRevision + 1,
      compiledCount: result.compiled.length,
    },
    reason: body.reason,
    statements,
  });
  return saved.ok
    ? c.json({ ...saved.response, replayed: saved.replayed })
    : c.json({ error: saved.error }, 409);
});

router.post('/:year/successor', requireStepUpAuth(), async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const parsed = StartSchema.omit({ year: true, source_session_id: true })
    .merge(AnnualPlanExpectedSchema)
    .extend({ accept_successor: z.literal(true) })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  if (Number(parsed.data.effective_on.slice(0, 4)) !== year)
    return c.json({ error: 'effective_year_mismatch' }, 400);
  const key = c.req.header('Idempotency-Key');
  if (!key || key !== key.trim() || key.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const result = await createAnnualPlanSuccessor(c.env.DB, {
    year,
    key,
    body: parsed.data,
    actorSubject: String(c.get('claims').sub),
    actorId: c.get('claims').member_id,
  });
  return result.ok
    ? c.json({ ...result.response, replayed: result.replayed })
    : c.json({ error: result.error }, 409);
});

router.get('/:year/successors', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const rows =
    await c.env.DB.prepare(`SELECT request_json,response_json,created_at FROM annual_plan_receipts
    WHERE json_extract(request_json,'$.year')=? AND json_extract(request_json,'$.operation')='create-successor-setup' ORDER BY created_at DESC`)
      .bind(year)
      .all<{ request_json: string; response_json: string; created_at: number }>();
  return c.json({
    successors: rows.results.map((r) => ({
      ...JSON.parse(r.response_json),
      reason: JSON.parse(r.request_json).body.reason,
      createdAt: r.created_at,
    })),
  });
});

router.get('/:year', async (c) => {
  const year = Number(c.req.param('year'));
  if (!Number.isInteger(year) || year < 2024 || year > 2100)
    return c.json({ error: 'invalid_year' }, 400);
  const row =
    await c.env.DB.prepare(`SELECT y.year, y.status, y.rule_book_version AS ruleBookVersion,
    y.position_template_version AS templateVersion, y.annual_policy_document_id AS annualPolicyDocumentId,
    y.configuration_revision AS configurationRevision, y.config_json AS configJson,
    p.effective_on AS effectiveOn, p.source_session_id AS sourceSessionId,
    p.revision AS reviewRevision, p.reviewed_source_revision AS reviewedSourceRevision,
    p.reviewed_rule_revision AS reviewedRuleRevision,
    b.status AS ruleBookStatus, b.revision AS ruleBookRevision
    FROM bid_years y LEFT JOIN annual_plan_reviews p ON p.bid_year = y.year
    LEFT JOIN rule_books b ON b.version = y.rule_book_version WHERE y.year = ?`)
      .bind(year)
      .first<
        {
          year: number;
          status: string;
          ruleBookVersion: string | null;
          templateVersion: string | null;
          configJson: string | null;
          ruleBookStatus: string | null;
        } & Record<string, unknown>
      >();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const source = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  const settings = parseBidConfigurationSettings(row.configJson);
  const coverage = row.ruleBookVersion
    ? await loadRuleBookCoverage(getDb(c.env.DB), row.ruleBookVersion)
    : null;
  const { configJson: _raw, ...plan } = row;
  const [baseline, sessions] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id,accepted_at AS acceptedAt FROM bid_year_staffing_baselines WHERE bid_year=? AND status='accepted'",
    )
      .bind(year)
      .first(),
    c.env.DB.prepare(
      'SELECT id,is_mock AS isMock,current_phase AS currentPhase,started_at AS startedAt FROM bid_sessions WHERE bid_year=? ORDER BY started_at DESC,id DESC',
    )
      .bind(year)
      .all(),
  ]);
  return c.json({
    plan: {
      ...plan,
      sourceRevision: source?.revision ?? null,
      settings,
      baseline,
      sessions: sessions.results,
      lifecycle: !row.ruleBookVersion
        ? 'UNCONFIGURED'
        : row.ruleBookStatus === 'draft'
          ? 'DRAFT'
          : row.ruleBookStatus === 'active'
            ? 'FROZEN'
            : 'INCONSISTENT',
    },
    coverage: coverage
      ? {
          valid: coverage.valid,
          ruleCount: coverage.ruleCount,
          missingBiddablePositionIds: coverage.missingBiddablePositionIds,
        }
      : null,
  });
});

export default router;

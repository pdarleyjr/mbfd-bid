import { BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import { getDb } from '../db/index.js';
import { annualEligibilityImpact } from './annual-eligibility-impact.js';
import { evaluateAuthoritativeStaffingBaseline } from './authoritative-staffing-baseline.js';
import {
  eligibilityMemberFromFrozen,
  loadRuleBookCoverage,
  parseBidConfigurationSettings,
  prepareBidSessionPolicySnapshot,
} from './bid-policy.js';
import { loadOfficialAnnualCompletion } from './official-annual-completion.js';
import { decodeRuleBookRows } from './position-rule.js';

type PlanReviewRow = {
  year: number;
  book: string;
  template: string;
  ruleRevision: number;
  configurationRevision: number;
  sourceRevision: number;
  effectiveOn: string;
  sourceSessionId: string | null;
  settingsJson: string;
  ruleStatus: string;
  reviewRevision: number;
};
export async function loadAnnualPlanReview(
  database: D1Database,
  year: number,
  baselineSource: 'official' | 'last_review' = 'official',
) {
  const plan = await database
    .prepare(`SELECT y.year,y.rule_book_version AS book,y.position_template_version AS template,y.configuration_revision AS configurationRevision,y.config_json AS settingsJson,
    b.revision AS ruleRevision,b.status AS ruleStatus,p.effective_on AS effectiveOn,p.source_session_id AS sourceSessionId,p.revision AS reviewRevision,
    (SELECT revision FROM annual_source_revision WHERE id=1) AS sourceRevision
    FROM bid_years y JOIN annual_plan_reviews p ON p.bid_year=y.year JOIN rule_books b ON b.version=y.rule_book_version WHERE y.year=?`)
    .bind(year)
    .first<PlanReviewRow>();
  if (!plan) return { ok: false as const, error: 'managed_annual_plan_required' };
  const db = getDb(database);
  const [coverage, prepared, baseline, participation, profile, official, checkpoint] =
    await Promise.all([
      loadRuleBookCoverage(db, plan.book),
      prepareBidSessionPolicySnapshot(db, year, Date.now(), 'mock'),
      evaluateAuthoritativeStaffingBaseline(db, year),
      database
        .prepare(
          `SELECT p.id AS position_id FROM positions p
         LEFT JOIN rule_book_position_participation part ON part.rule_book_version=? AND part.position_id=p.id AND part.template_version=p.template_version
         LEFT JOIN position_staffing_bindings binding ON binding.position_id=p.id AND binding.template_version=p.template_version
         WHERE p.template_version=? AND (part.position_id IS NULL OR part.authoritative_source_ref LIKE 'inherited-unreviewed:%'
           OR binding.position_id IS NULL OR binding.review_status<>'approved' OR binding.authoritative_source_ref LIKE 'inherited-unreviewed:%')`,
        )
        .bind(plan.book, plan.template)
        .all<{ position_id: string }>(),
      database
        .prepare(
          'SELECT rule_revision FROM annual_rule_profile_revisions WHERE bid_year=? ORDER BY revision DESC LIMIT 1',
        )
        .bind(year)
        .first<{ rule_revision: number }>(),
      plan.sourceSessionId
        ? loadOfficialAnnualCompletion(database, plan.sourceSessionId)
        : Promise.resolve(null),
      database
        .prepare(
          'SELECT id,snapshot_json,rule_revision,configuration_revision,source_revision,created_at FROM annual_source_review_checkpoints WHERE bid_year=? ORDER BY created_at DESC,id DESC LIMIT 1',
        )
        .bind(year)
        .first<{
          id: string;
          snapshot_json: string;
          rule_revision: number;
          configuration_revision: number;
          source_revision: number;
          created_at: number;
        }>(),
    ]);
  let reviewedSnapshot: Extract<
    ReturnType<typeof BidSessionPolicySnapshotSchema.parse>,
    { v: 3 }
  > | null = null;
  if (baselineSource === 'last_review' && checkpoint) {
    try {
      const parsed = BidSessionPolicySnapshotSchema.safeParse(JSON.parse(checkpoint.snapshot_json));
      if (parsed.success && parsed.data.v === 3) reviewedSnapshot = parsed.data;
    } catch {
      /* Incomparable evidence is reported, never replaced with current data. */
    }
  }
  const previous =
    baselineSource === 'official'
      ? official
      : reviewedSnapshot
        ? { ok: true as const, snapshot: reviewedSnapshot }
        : null;
  const settings = parseBidConfigurationSettings(plan.settingsJson);
  const blockers: { code: string; detail: string }[] = [];
  const block = (code: string, detail: string) => blockers.push({ code, detail });
  if (!coverage.valid)
    block('rule_coverage', 'Every biddable seat requires exactly one valid rule.');
  if (!prepared.ok)
    block(
      prepared.code,
      'Session preparation did not accept the designated configuration and source evidence.',
    );
  if (!prepared.ok && prepared.tenureIssues)
    for (const issue of prepared.tenureIssues)
      block(issue.code, `Review tenure evidence for staffing seat ${issue.staffingPositionId}.`);
  if (baseline.status !== 'PASS')
    block(
      'authoritative_staffing_baseline_required',
      'The annual source baseline has not passed its existing acceptance checks.',
    );
  if (participation.results.length)
    block(
      'inherited_participation_unreviewed',
      `${participation.results.length} annual seats require explicit participation and approved staffing bindings.`,
    );
  if (profile && profile.rule_revision !== plan.ruleRevision)
    block(
      'profiles_require_reconciliation',
      'Individual rules or seats changed after the last profile compilation.',
    );
  if (!settings || settings.v !== 3)
    block('operating_policy_required', 'Designate a complete annual operating policy.');
  if (settings && settings.v !== 1 && settings.personnelEvaluationOn !== plan.effectiveOn)
    block('personnel_date_mismatch', 'The personnel evaluation date differs from the annual plan.');
  if (official && !official.ok)
    block(
      'official_source_unavailable',
      'The selected historical completion could not be verified.',
    );
  const previousPositions = previous?.ok ? previous.snapshot.ruleBookMaterial.positions : [];
  const currentPositions = await database
    .prepare(
      'SELECT id,shift,station,division,unit,rank_required AS rankRequired,position_name AS positionName,is_floating AS isFloating,is_vacant_by_design AS isVacantByDesign,is_excluded_from_count AS isExcludedFromCount FROM positions WHERE template_version=? ORDER BY id',
    )
    .bind(plan.template)
    .all<Record<string, unknown> & { id: string }>();
  const oldPositions = new Map(previousPositions.map((p) => [p.id, p]));
  const currentIds = new Set(currentPositions.results.map((p) => p.id));
  const fields = [
    'shift',
    'station',
    'division',
    'unit',
    'rankRequired',
    'positionName',
    'isFloating',
    'isVacantByDesign',
    'isExcludedFromCount',
  ] as const;
  const changes = currentPositions.results.flatMap((p) => {
    const old = oldPositions.get(p.id);
    if (!old)
      return [
        { positionId: p.id, kind: previous?.ok ? 'ADDED' : 'CURRENT', fields: [] as string[] },
      ];
    const changed = fields.filter((field) =>
      typeof old[field] === 'boolean' ? Number(old[field]) !== p[field] : old[field] !== p[field],
    );
    return changed.length ? [{ positionId: p.id, kind: 'CHANGED', fields: [...changed] }] : [];
  });
  for (const p of previousPositions)
    if (!currentIds.has(p.id)) changes.push({ positionId: p.id, kind: 'REMOVED', fields: [] });
  const priorRules = previous?.ok
    ? decodeRuleBookRows(previous.snapshot.ruleBookMaterial.rules).rules
    : [];
  const impact =
    prepared.ok && previous?.ok
      ? annualEligibilityImpact({
          beforeMembers: previous.snapshot.members
            .filter((m) => m.pool !== 'EXCLUDED' && m.rank !== 'CIVILIAN')
            .map((m) => ({ memberId: m.memberId, evidence: eligibilityMemberFromFrozen(m) })),
          afterMembers: prepared.snapshot.members
            .filter((m) => m.pool !== 'EXCLUDED' && m.rank !== 'CIVILIAN')
            .map((m) => ({ memberId: m.memberId, evidence: eligibilityMemberFromFrozen(m) })),
          beforeRules: priorRules,
          afterRules: prepared.coverage.rules,
        })
      : null;
  const after = await database
    .prepare(
      'SELECT y.configuration_revision AS configurationRevision,b.revision AS ruleRevision,p.revision AS reviewRevision,(SELECT revision FROM annual_source_revision WHERE id=1) AS sourceRevision FROM bid_years y JOIN rule_books b ON b.version=y.rule_book_version JOIN annual_plan_reviews p ON p.bid_year=y.year WHERE y.year=?',
    )
    .bind(year)
    .first<{
      configurationRevision: number;
      ruleRevision: number;
      sourceRevision: number;
      reviewRevision: number;
    }>();
  if (
    !after ||
    after.configurationRevision !== plan.configurationRevision ||
    after.ruleRevision !== plan.ruleRevision ||
    after.sourceRevision !== plan.sourceRevision ||
    after.reviewRevision !== plan.reviewRevision
  )
    return { ok: false as const, error: 'annual_plan_or_source_changed' };
  return {
    ok: true as const,
    year,
    ruleBookVersion: plan.book,
    ruleRevision: plan.ruleRevision,
    configurationRevision: plan.configurationRevision,
    sourceRevision: plan.sourceRevision,
    reviewRevision: plan.reviewRevision,
    ready: blockers.length === 0,
    blockers,
    coverage: {
      valid: coverage.valid,
      ruleCount: coverage.ruleCount,
      missingBiddablePositionIds: coverage.missingBiddablePositionIds,
    },
    sourceSessionId: plan.sourceSessionId,
    comparisonSource: baselineSource,
    checkpoint: checkpoint
      ? {
          id: checkpoint.id,
          ruleRevision: checkpoint.rule_revision,
          configurationRevision: checkpoint.configuration_revision,
          sourceRevision: checkpoint.source_revision,
          reviewedAt: checkpoint.created_at,
        }
      : null,
    changes,
    impact: {
      scope:
        'Same current annual participant cohort and qualification date; selected baseline rules versus upcoming rules at matching stable position IDs. This is not historical replay.',
      available: prepared.ok && previous?.ok === true,
      ...(impact ?? {
        evaluatedComparisons: 0,
        changed: [],
        evidence: { evaluatedComparisons: 0, changed: [] },
        incomparable: null,
      }),
      evidenceScope:
        'Prior rules held constant; prior frozen participants and qualifications versus current annual participants and qualifications. Includes evidence-date and cohort effects on priority. Added or removed members and positions are counted separately.',
      priorityScope:
        'Eligible candidate priority under each configured tie-break chain; equal results retain equal priority. This does not simulate choices, availability, amendments or awards.',
    },
    participants: prepared.ok
      ? {
          included: prepared.snapshot.members.filter((m) => m.pool !== 'EXCLUDED').length,
          excluded: prepared.snapshot.members.filter((m) => m.pool === 'EXCLUDED').length,
        }
      : null,
  };
}

import {
  type AdminBidBoard,
  AdminBidBoardSchema,
  AdminBoardViewSchema,
  type JwtPayload,
} from '@mbfd/shared';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { loadRuleBookCoverage, parseBidConfigurationSettings } from '../../lib/bid-policy.js';
import { loadOfficialAnnualCompletion } from '../../lib/official-annual-completion.js';
import { operationalDate } from '../../lib/operational-date.js';
import { isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import type { WorkerEnv } from '../../types/env.js';
import { loadCurrentRosterProjection } from './current-roster.js';
import { requireAdmin } from './middleware.js';

const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);

const source = (label: string): AdminBidBoard['source'] => ({
  label,
  year: null,
  asOf: null,
  sessionId: null,
  templateVersion: null,
  ruleBookVersion: null,
  configurationRevision: null,
  ruleBookRevision: null,
  completionRevision: null,
});

router.get('/', async (c) => {
  const parsedView = AdminBoardViewSchema.safeParse(c.req.query('view') ?? 'current');
  if (!parsedView.success) return c.json({ error: 'invalid_board_selection' }, 400);
  const view = parsedView.data;
  const shift = c.req.query('shift') ?? 'A';
  if (!['previous', 'current', 'upcoming'].includes(view) || !['A', 'B', 'C', 'D'].includes(shift))
    return c.json({ error: 'invalid_board_selection' }, 400);
  const generatedAt = new Date().toISOString();
  let result: AdminBidBoard;
  if (view === 'current') {
    const asOf = c.req.query('as_of') ?? operationalDate();
    if (!isIsoCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);
    const roster = await loadCurrentRosterProjection(c.env.DB, asOf, [
      { name: 'shift', value: shift },
    ]);
    if (!roster.ok) return c.json({ error: roster.error }, 409);
    result = {
      view,
      lifecycle: 'CURRENT',
      generatedAt,
      source: { ...source('Canonical effective-dated staffing'), asOf },
      notice: null,
      seats: roster.projection.positions.map((p) => ({
        id: p.id,
        shift: p.shift,
        station: p.station,
        unit: p.unit,
        position: p.positionName,
        rank: p.applicableRank,
        occupancy:
          p.station === null || p.unit === null || p.positionName === null
            ? 'unmapped'
            : p.occupancy,
        occupant: p.member
          ? {
              memberId: p.member.id,
              name: [p.member.firstName, p.member.lastName].filter(Boolean).join(' ') || null,
              nameSource: 'current',
            }
          : null,
        assignmentOrigin: p.assignment?.originType ?? null,
        temporaryContext: p.temporaryContext,
      })),
    };
  } else if (view === 'upcoming') {
    const yearText = c.req.query('year');
    if (!yearText || !/^\d{4}$/.test(yearText))
      return c.json({ error: 'select_annual_plan_year' }, 400);
    const year = Number(yearText);
    const plan =
      await c.env.DB.prepare(`SELECT y.position_template_version AS templateVersion, y.rule_book_version AS ruleBookVersion,
      y.configuration_revision AS configurationRevision, y.config_json AS configJson, b.status, b.revision AS ruleBookRevision,
      b.effective_year AS effectiveYear FROM bid_years y LEFT JOIN rule_books b ON b.version = y.rule_book_version WHERE y.year = ?`)
        .bind(year)
        .first<{
          templateVersion: string | null;
          ruleBookVersion: string | null;
          configurationRevision: number;
          configJson: string | null;
          status: string;
          ruleBookRevision: number;
          effectiveYear: number;
        }>();
    if (
      !plan ||
      !plan.templateVersion ||
      !plan.ruleBookVersion ||
      plan.effectiveYear !== year ||
      !['draft', 'active'].includes(plan.status) ||
      !parseBidConfigurationSettings(plan.configJson)
    )
      return c.json({ error: 'annual_configuration_missing_or_inconsistent' }, 409);
    const positions =
      await c.env.DB.prepare(`SELECT p.id, p.shift, p.station, p.unit, p.position_name AS position, p.rank_required AS rank,
      COALESCE(part.bid_participation, 'BIDDABLE') AS participation,
      CASE WHEN binding.review_status = 'approved' THEN 'mapped' ELSE 'review_required' END AS mapping
      FROM positions p LEFT JOIN rule_book_position_participation part ON part.position_id = p.id AND part.template_version = p.template_version AND part.rule_book_version = ?
      LEFT JOIN position_staffing_bindings binding ON binding.position_id = p.id AND binding.template_version = p.template_version
      WHERE p.template_version = ? AND p.shift = ? ORDER BY p.station, p.unit, p.id`)
        .bind(plan.ruleBookVersion, plan.templateVersion, shift)
        .all();
    const coverage = await loadRuleBookCoverage(getDb(c.env.DB), plan.ruleBookVersion);
    if (coverage.templateVersion !== null && coverage.templateVersion !== plan.templateVersion)
      return c.json({ error: 'annual_configuration_template_mismatch' }, 409);
    result = AdminBidBoardSchema.parse({
      view,
      lifecycle: plan.status === 'draft' ? 'DRAFT' : 'FROZEN',
      generatedAt,
      source: {
        ...source('Designated annual configuration'),
        year,
        templateVersion: plan.templateVersion,
        ruleBookVersion: plan.ruleBookVersion,
        configurationRevision: plan.configurationRevision,
        ruleBookRevision: plan.ruleBookRevision,
      },
      notice: coverage.valid
        ? null
        : 'Rule coverage needs review. These seats do not establish readiness to start a Bid.',
      seats: positions.results,
    });
  } else {
    const selected = c.req.query('session');
    const candidates = selected
      ? [{ id: selected }]
      : (
          await c.env.DB.prepare(`SELECT s.id FROM bid_sessions s
      JOIN canonical_bid_session_state state ON state.bid_session_id = s.id WHERE s.is_mock = 0 ORDER BY s.bid_year DESC, state.updated_at DESC, s.id`).all<{
            id: string;
          }>()
        ).results;
    result = {
      view,
      lifecycle: 'UNAVAILABLE',
      generatedAt,
      source: source('Verified official completion'),
      seats: [],
      notice:
        'No verified completed official Bid is available. Mock, incomplete and unverified sessions are excluded.',
    };
    for (const candidate of candidates) {
      const official = await loadOfficialAnnualCompletion(c.env.DB, candidate.id);
      if (!official.ok) continue;
      const awards = new Map(official.completion.participants.map((p) => [p.positionId, p]));
      const identities = new Map(
        (official.snapshot.operatorIdentityProjection ?? []).map((m) => [m.memberId, m]),
      );
      result = {
        view,
        lifecycle: 'COMPLETE',
        generatedAt,
        notice: null,
        source: {
          ...source('Frozen topology and verified canonical final awards'),
          year: official.completion.bidYear,
          sessionId: candidate.id,
          templateVersion: official.snapshot.positionTemplateVersion,
          ruleBookVersion: official.snapshot.ruleBookVersion,
          ruleBookRevision: official.snapshot.ruleBookRevision,
          configurationRevision: official.snapshot.configurationRevision,
          completionRevision: official.completion.completion.revision,
        },
        seats: official.snapshot.ruleBookMaterial.positions
          .filter((p) => p.shift === shift)
          .map((p) => {
            const award = awards.get(p.id);
            const identity = award ? identities.get(award.memberId) : null;
            return {
              id: p.id,
              shift: p.shift,
              station: p.station,
              unit: p.unit,
              position: p.positionName,
              rank: p.rankRequired,
              award: award
                ? {
                    memberId: award.memberId,
                    name: identity ? `${identity.firstName} ${identity.lastName}` : null,
                    nameSource: identity ? 'frozen' : 'unavailable',
                  }
                : null,
              aDay: award?.aDay ?? null,
            };
          }),
      };
      break;
    }
  }
  c.header('Cache-Control', 'private, no-store');
  return c.json(AdminBidBoardSchema.parse(result));
});

export default router;

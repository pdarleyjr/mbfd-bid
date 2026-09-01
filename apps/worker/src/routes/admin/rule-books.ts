import { zValidator } from '@hono/zod-validator';
import {
  CreateRuleBookSchema,
  type JwtPayload,
  PublishRuleBookSchema,
  ReasonCodeSchema,
} from '@mbfd/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import {
  bidYears,
  positionRules,
  positions,
  ruleBookPositionParticipation,
  ruleBooks,
} from '../../db/schema.js';
import { auditInsertStatement, writeAuditLog } from '../../lib/audit.js';
import {
  loadRuleBookCoverage,
  loadRuleBookPolicyDiff,
  preflightConfiguredRuleBookPublication,
} from '../../lib/bid-policy.js';
import { isReasonValidForAction } from '../../lib/reason-codes.js';
import { nextVersion } from '../../lib/rule-book-version.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

const SetPositionParticipationSchema = z
  .object({
    template_version: z.string().trim().min(1).max(100),
    bid_participation: z.literal('ADMIN_ASSIGNED_NON_BIDDABLE'),
    authoritative_source_ref: z.string().trim().min(1).max(500),
    reason_code: ReasonCodeSchema,
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

// GET /api/admin/rule-books
router.get('/', async (c) => {
  const year = c.req.query('effective_year');
  const db = getDb(c.env.DB);
  const rows = year
    ? await db
        .select()
        .from(ruleBooks)
        .where(eq(ruleBooks.effectiveYear, Number(year)))
        .orderBy(desc(ruleBooks.effectiveYear), desc(ruleBooks.version))
        .all()
    : await db
        .select()
        .from(ruleBooks)
        .orderBy(desc(ruleBooks.effectiveYear), desc(ruleBooks.version))
        .all();
  return c.json({ rule_books: rows });
});

// POST /api/admin/rule-books   (step-up; creates draft, optionally clones)
router.post('/', requireStepUpAuth(), zValidator('json', CreateRuleBookSchema), async (c) => {
  const { effective_year, clone_from, notes, reason } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const allVersions = await db.select({ v: ruleBooks.version }).from(ruleBooks).all();
  const newVersion = nextVersion(
    effective_year,
    allVersions.map((r) => r.v),
  );

  let sourceRuleBook: typeof ruleBooks.$inferSelect | null = null;
  if (clone_from !== undefined) {
    const src = await db.select().from(ruleBooks).where(eq(ruleBooks.version, clone_from)).get();
    if (src === undefined) {
      return c.json({ error: 'clone_from_not_found', clone_from }, 400);
    }
    sourceRuleBook = src;
  }

  // A predicted draft version must never be externally visible with only a
  // partial clone: a concurrent publisher could otherwise validate a prefix
  // of the source book, activate it, and let this request append more rows to
  // that active book. D1 executes this batch as one transaction.
  const insertRuleBook = c.env.DB.prepare(
    `INSERT INTO rule_books (version, effective_year, notes, status)
       VALUES (?, ?, ?, 'draft')`,
  ).bind(newVersion, effective_year, notes ?? null);
  const claims = c.get('claims');
  const beforeState = {
    clone_from: clone_from ?? null,
    source_rule_book:
      sourceRuleBook === null
        ? null
        : {
            version: sourceRuleBook.version,
            effective_year: sourceRuleBook.effectiveYear,
            status: sourceRuleBook.status,
            revision: sourceRuleBook.revision,
          },
  };
  const afterState = {
    version: newVersion,
    effective_year,
    status: 'draft',
    clone_from: clone_from ?? null,
    notes: notes ?? null,
  };
  const auditStatement = c.env.DB.prepare(
    `INSERT INTO audit_log (
         id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
         target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at
       )
       SELECT ?, NULL, COALESCE(MAX(seq), 0) + 1, 'admin', ?, 'rule_book_clone',
              'rule_book', ?, ?, ?, ?, NULL, NULL, ?
         FROM audit_log
        WHERE bid_session_id IS NULL`,
  ).bind(
    ulid(),
    claims.sub ?? null,
    newVersion,
    JSON.stringify(beforeState),
    JSON.stringify(afterState),
    reason,
    Math.floor(Date.now() / 1000),
  );
  const statements: D1PreparedStatement[] = [insertRuleBook];
  if (clone_from !== undefined) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO position_rules (
             rule_book_version,
             position_id,
             template_version,
             required_criteria,
             points_preference,
             tie_break_chain,
             notes
           )
           SELECT ?, position_id, template_version, required_criteria,
                  points_preference, tie_break_chain, notes
             FROM position_rules
            WHERE rule_book_version = ?`,
      ).bind(newVersion, clone_from),
      c.env.DB.prepare(
        `INSERT INTO rule_book_position_participation (
              rule_book_version,
              position_id,
              template_version,
              bid_participation,
              authoritative_source_ref,
              created_at
            )
            SELECT ?, position_id, template_version, bid_participation,
                   authoritative_source_ref, created_at
              FROM rule_book_position_participation
            WHERE rule_book_version = ?`,
      ).bind(newVersion, clone_from),
    );
  }
  // The draft, all copied policy rows, and its receipt must be one D1
  // transaction: no partial clone can be exposed or audited independently.
  statements.push(auditStatement);
  await c.env.DB.batch(statements);

  return c.json({ version: newVersion, status: 'draft' }, 201);
});

// GET /api/admin/rule-books/:version/coverage
// Read-only, identifier-only policy coverage for a draft review or active
// administrative verification. It contains no roster or assignment data.
router.get('/:version/coverage', async (c) => {
  const version = c.req.param('version');
  const db = getDb(c.env.DB);
  const book = await db.select().from(ruleBooks).where(eq(ruleBooks.version, version)).get();
  if (book === undefined) return c.json({ error: 'not_found' }, 404);
  const coverage = await loadRuleBookCoverage(db, version);
  return c.json({
    rule_book_version: version,
    status: book.status,
    valid: coverage.valid,
    rule_count: coverage.ruleCount,
    template_version: coverage.templateVersion,
    expected_biddable_position_ids: coverage.expectedBiddablePositionIds,
    valid_rule_position_ids: coverage.validRulePositionIds,
    administratively_assigned_position_ids: coverage.administrativelyAssignedPositionIds,
    legacy_excluded_position_ids: coverage.legacyExcludedPositionIds,
    invalid_position_ids: coverage.invalidPositionIds,
    duplicate_position_ids: coverage.duplicatePositionIds,
    missing_biddable_position_ids: coverage.missingBiddablePositionIds,
    non_biddable_position_ids: coverage.nonBiddablePositionIds,
    unexpected_position_ids: coverage.unexpectedPositionIds,
    template_version_issues: coverage.templateVersionIssues,
  });
});

// GET /api/admin/rule-books/:version/diff?baseline=2026.1&expected_position_ids=A211,B211,C211
// An identifier-only exact diff for the draft publication review. Supplying
// expected ids does not authorize a change; it simply calculates which
// changed positions still require an operator's explanation.
router.get('/:version/diff', async (c) => {
  const version = c.req.param('version');
  const baseline = c.req.query('baseline')?.trim();
  if (!baseline) return c.json({ error: 'baseline_required' }, 400);
  const expectedPositionIds = (c.req.query('expected_position_ids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((a, b) => a.localeCompare(b));
  const db = getDb(c.env.DB);
  const [baselineBook, candidateBook] = await Promise.all([
    db
      .select({ version: ruleBooks.version })
      .from(ruleBooks)
      .where(eq(ruleBooks.version, baseline))
      .get(),
    db
      .select({ version: ruleBooks.version })
      .from(ruleBooks)
      .where(eq(ruleBooks.version, version))
      .get(),
  ]);
  if (baselineBook === undefined) return c.json({ error: 'baseline_not_found', baseline }, 404);
  if (candidateBook === undefined) return c.json({ error: 'not_found' }, 404);
  const diff = await loadRuleBookPolicyDiff(db, baseline, version);
  const unexpectedPositionIds = diff.changedPositionIds.filter(
    (positionId) => !expectedPositionIds.includes(positionId),
  );
  const missingExpectedPositionIds = expectedPositionIds.filter(
    (positionId) => !diff.changedPositionIds.includes(positionId),
  );
  return c.json({
    ...diff,
    expected_position_ids: expectedPositionIds,
    unexpected_position_ids: unexpectedPositionIds,
    missing_expected_position_ids: missingExpectedPositionIds,
  });
});

// PUT /api/admin/rule-books/:version/position-participation/:positionId
// A participation override is versioned with a draft rule book. This is the
// normal lifecycle boundary for an approved administrative-staffing decision;
// it cannot reinterpret the immutable active book in place.
router.put(
  '/:version/position-participation/:positionId',
  requireStepUpAuth(),
  zValidator('json', SetPositionParticipationSchema),
  async (c) => {
    const version = c.req.param('version');
    const positionId = c.req.param('positionId');
    const body = c.req.valid('json');
    if (!isReasonValidForAction('override_rule', body.reason_code)) {
      return c.json(
        {
          error: 'invalid_reason_for_action',
          action: 'override_rule',
          reason_code: body.reason_code,
        },
        400,
      );
    }

    const db = getDb(c.env.DB);
    const book = await db.select().from(ruleBooks).where(eq(ruleBooks.version, version)).get();
    if (book === undefined) return c.json({ error: 'not_found' }, 404);
    if (book.status !== 'draft') {
      return c.json({ error: 'rule_book_immutable', status: book.status }, 409);
    }

    const [bookTemplates, position] = await Promise.all([
      db
        .select({ templateVersion: positionRules.templateVersion })
        .from(positionRules)
        .where(eq(positionRules.ruleBookVersion, version))
        .all(),
      db
        .select({ id: positions.id, isExcludedFromCount: positions.isExcludedFromCount })
        .from(positions)
        .where(
          and(eq(positions.id, positionId), eq(positions.templateVersion, body.template_version)),
        )
        .get(),
    ]);
    const templateVersions = [...new Set(bookTemplates.map((row) => row.templateVersion))];
    if (templateVersions.length !== 1 || templateVersions[0] !== body.template_version) {
      return c.json(
        {
          error: 'rule_book_template_mismatch',
          rule_book_template_versions: templateVersions,
          requested_template_version: body.template_version,
        },
        409,
      );
    }
    if (position === undefined) return c.json({ error: 'position_not_found' }, 404);
    if (position.isExcludedFromCount) {
      return c.json({ error: 'legacy_excluded_position_not_administrative' }, 409);
    }

    const before = await db
      .select()
      .from(ruleBookPositionParticipation)
      .where(
        and(
          eq(ruleBookPositionParticipation.ruleBookVersion, version),
          eq(ruleBookPositionParticipation.positionId, positionId),
        ),
      )
      .get();
    const now = Date.now();
    const after = {
      ruleBookVersion: version,
      positionId,
      templateVersion: body.template_version,
      bidParticipation: body.bid_participation,
      authoritativeSourceRef: body.authoritative_source_ref,
      createdAt: new Date(now),
    };
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO rule_book_position_participation (
             rule_book_version, position_id, template_version, bid_participation,
             authoritative_source_ref, created_at
           )
           SELECT ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1 FROM rule_books
               WHERE version = ? AND status = 'draft' AND revision = ?
            )
           ON CONFLICT(rule_book_version, position_id) DO UPDATE SET
             template_version = excluded.template_version,
             bid_participation = excluded.bid_participation,
             authoritative_source_ref = excluded.authoritative_source_ref,
             created_at = excluded.created_at`,
      ).bind(
        version,
        positionId,
        body.template_version,
        body.bid_participation,
        body.authoritative_source_ref,
        now,
        version,
        book.revision,
      ),
      c.env.DB.prepare(
        `UPDATE rule_books
              SET revision = revision + 1
            WHERE version = ? AND status = 'draft' AND revision = ?`,
      ).bind(version, book.revision),
      auditInsertStatement(
        c.env.DB,
        {
          bidSessionId: null,
          actorType: 'admin',
          actorId: c.get('claims').sub > 0 ? c.get('claims').sub : null,
          action: 'override_rule',
          targetKind: 'rule_book_position_participation',
          targetId: `${version}:${positionId}`,
          reason: body.reason,
          beforeState: before,
          afterState: after,
        },
        new Date(now),
      ),
    ]);
    if (
      results[0]?.meta.changes !== 1 ||
      results[1]?.meta.changes !== 1 ||
      results[2]?.meta.changes !== 1
    ) {
      const current = await db.select().from(ruleBooks).where(eq(ruleBooks.version, version)).get();
      if (current?.status !== 'draft') {
        return c.json({ error: 'rule_book_immutable', status: current?.status ?? 'missing' }, 409);
      }
      return c.json({ error: 'rule_book_changed' }, 409);
    }

    const persisted = await db
      .select()
      .from(ruleBookPositionParticipation)
      .where(
        and(
          eq(ruleBookPositionParticipation.ruleBookVersion, version),
          eq(ruleBookPositionParticipation.positionId, positionId),
        ),
      )
      .get();
    return c.json({ participation: persisted, rule_book_revision: book.revision + 1 });
  },
);

// POST /api/admin/rule-books/:version/publish   (step-up; atomic swap)
router.post(
  '/:version/publish',
  requireStepUpAuth(),
  zValidator('json', PublishRuleBookSchema),
  async (c) => {
    const version = c.req.param('version');
    const { reason } = c.req.valid('json');
    const db = getDb(c.env.DB);

    const target = await db.select().from(ruleBooks).where(eq(ruleBooks.version, version)).get();
    if (target === undefined) return c.json({ error: 'not_found' }, 404);
    if (target.status === 'active') return c.json({ error: 'already_active' }, 409);
    if (target.status === 'archived') return c.json({ error: 'archived_cannot_republish' }, 409);

    // Decoder validity alone is insufficient: a candidate book must cover
    // every BIDDABLE annual position exactly once and must never carry a
    // rule for an administratively assigned/non-biddable staffing slot.
    const coverage = await loadRuleBookCoverage(db, version);
    if (!coverage.valid) {
      return c.json(
        {
          error: 'rule_book_invalid',
          empty_rule_book: coverage.ruleCount === 0,
          invalid_position_ids: coverage.invalidPositionIds,
          duplicate_position_ids: coverage.duplicatePositionIds,
          missing_biddable_position_ids: coverage.missingBiddablePositionIds,
          non_biddable_position_ids: coverage.nonBiddablePositionIds,
          unexpected_position_ids: coverage.unexpectedPositionIds,
          template_version_issues: coverage.templateVersionIssues,
        },
        409,
      );
    }

    // A draft cannot become the annual live configuration merely because it
    // is valid in isolation. The bid year must have explicitly designated
    // this exact draft/template first, so mocks and the eventual live session
    // share one configuration source rather than an opportunistic active book.
    const configuredYear = await db
      .select({
        ruleBookVersion: bidYears.ruleBookVersion,
        positionTemplateVersion: bidYears.positionTemplateVersion,
        configurationRevision: bidYears.configurationRevision,
      })
      .from(bidYears)
      .where(eq(bidYears.year, target.effectiveYear))
      .get();
    if (
      configuredYear === undefined ||
      configuredYear.ruleBookVersion !== version ||
      configuredYear.positionTemplateVersion !== coverage.templateVersion
    ) {
      return c.json(
        {
          error: 'bid_configuration_not_designated',
          effective_year: target.effectiveYear,
          rule_book_version: version,
        },
        409,
      );
    }

    // Coverage tells us that the draft is internally consistent. Publication
    // additionally needs the same authoritative staffing/binding proof used
    // for mock-session construction; otherwise a direct publish could freeze
    // a book that no safe mock or live session can use.
    const staffingPreflight = await preflightConfiguredRuleBookPublication(
      db,
      target.effectiveYear,
      Date.now(),
    );
    if (!staffingPreflight.ok) {
      return c.json(
        {
          error: 'rule_book_publication_blocked',
          blocker: staffingPreflight.code,
          position_ids:
            'positionIds' in staffingPreflight ? (staffingPreflight.positionIds ?? []) : [],
          // Aggregate-only source-accounting evidence. It deliberately omits
          // raw TeleStaff rows, names, Emp IDs, HMACs, and topology values.
          baseline: 'baseline' in staffingPreflight ? staffingPreflight.baseline : undefined,
        },
        409,
      );
    }

    const claims = c.get('claims');
    const actorId = claims.sub > 0 ? claims.sub : null;

    // D1 batches the state transition.  The archive is conditioned on the
    // exact draft revision that was validated above; if a PATCH wins the race,
    // neither statement changes the active policy.  Separating archive and
    // promotion also avoids depending on SQLite's row-update order around the
    // partial one-active-book unique index.
    const currentActive = await db
      .select({ version: ruleBooks.version })
      .from(ruleBooks)
      .where(and(eq(ruleBooks.effectiveYear, target.effectiveYear), eq(ruleBooks.status, 'active')))
      .get();
    const now = new Date();
    const statements: D1PreparedStatement[] = [];
    if (currentActive !== undefined) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE rule_books
               SET status = 'archived'
              WHERE version = ?
               AND effective_year = ?
               AND status = 'active'
               AND EXISTS (
                 SELECT 1 FROM rule_books
                  WHERE version = ? AND status = 'draft' AND revision = ?
                )
                AND EXISTS (
                  SELECT 1 FROM bid_years
                   WHERE year = ?
                     AND rule_book_version = ?
                     AND position_template_version = ?
                     AND configuration_revision = ?
                )
                AND EXISTS (
                  SELECT 1 FROM bid_year_staffing_baselines
                   WHERE id = ?
                     AND bid_year = ?
                     AND assignment_import_id = ?
                     AND status = 'accepted'
                )
                -- Source rows and observations are immutable after commit;
                -- re-check their mutable canonical projection inside the
                -- D1 publication batch to close the preflight-to-publish gap.
                AND NOT EXISTS (
                  SELECT 1
                  FROM assignment_import_rows row_record
                  WHERE row_record.import_id = ?
                    AND (
                      row_record.reconciliation_classification = 'UNCHANGED'
                      OR (
                        row_record.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
                        AND row_record.review_status = 'approved'
                        AND row_record.resolution_action = 'APPLY_OBSERVATION'
                      )
                    )
                    AND (
                      (SELECT COUNT(*)
                       FROM assignment_observations observation
                       WHERE observation.assignment_import_id = ?
                         AND observation.assignment_import_row_id = row_record.id) <> 1
                      OR (SELECT COUNT(*)
                          FROM member_assignments assignment_record
                          JOIN assignment_observations observation
                            ON observation.id = assignment_record.source_observation_id
                          JOIN staffing_positions position_record
                            ON position_record.id = assignment_record.staffing_position_id
                          WHERE observation.assignment_import_id = ?
                            AND observation.assignment_import_row_id = row_record.id
                            AND assignment_record.origin_type = 'TELESTAFF_IMPORT'
                            AND assignment_record.status = 'active'
                            AND position_record.review_status = 'approved') <> 1
                    )
                )`,
        ).bind(
          currentActive.version,
          target.effectiveYear,
          version,
          target.revision,
          target.effectiveYear,
          version,
          coverage.templateVersion,
          configuredYear.configurationRevision,
          staffingPreflight.baselineAcceptanceId,
          target.effectiveYear,
          staffingPreflight.baselineImportId,
          staffingPreflight.baselineImportId,
          staffingPreflight.baselineImportId,
          staffingPreflight.baselineImportId,
        ),
      );
    }
    statements.push(
      c.env.DB.prepare(
        `UPDATE rule_books
             SET status = 'active', published_at = ?, published_by = ?
           WHERE version = ?
             AND status = 'draft'
             AND revision = ?
               AND NOT EXISTS (
                 SELECT 1 FROM rule_books
                  WHERE effective_year = ? AND status = 'active'
               )
                AND EXISTS (
                  SELECT 1 FROM bid_years
                   WHERE year = ?
                     AND rule_book_version = ?
                     AND position_template_version = ?
                     AND configuration_revision = ?
                )
                AND EXISTS (
                  SELECT 1 FROM bid_year_staffing_baselines
                   WHERE id = ?
                     AND bid_year = ?
                     AND assignment_import_id = ?
                     AND status = 'accepted'
                )
                -- Keep the exact accepted baseline's mutable canonical
                -- projection valid in the same D1 batch as promotion.
                AND NOT EXISTS (
                  SELECT 1
                  FROM assignment_import_rows row_record
                  WHERE row_record.import_id = ?
                    AND (
                      row_record.reconciliation_classification = 'UNCHANGED'
                      OR (
                        row_record.reconciliation_classification IN ('MOVED', 'NEW_ASSIGNMENT')
                        AND row_record.review_status = 'approved'
                        AND row_record.resolution_action = 'APPLY_OBSERVATION'
                      )
                    )
                    AND (
                      (SELECT COUNT(*)
                       FROM assignment_observations observation
                       WHERE observation.assignment_import_id = ?
                         AND observation.assignment_import_row_id = row_record.id) <> 1
                      OR (SELECT COUNT(*)
                          FROM member_assignments assignment_record
                          JOIN assignment_observations observation
                            ON observation.id = assignment_record.source_observation_id
                          JOIN staffing_positions position_record
                            ON position_record.id = assignment_record.staffing_position_id
                          WHERE observation.assignment_import_id = ?
                            AND observation.assignment_import_row_id = row_record.id
                            AND assignment_record.origin_type = 'TELESTAFF_IMPORT'
                            AND assignment_record.status = 'active'
                            AND position_record.review_status = 'approved') <> 1
                    )
                )`,
      ).bind(
        now.getTime(),
        actorId,
        version,
        target.revision,
        target.effectiveYear,
        target.effectiveYear,
        version,
        coverage.templateVersion,
        configuredYear.configurationRevision,
        staffingPreflight.baselineAcceptanceId,
        target.effectiveYear,
        staffingPreflight.baselineImportId,
        staffingPreflight.baselineImportId,
        staffingPreflight.baselineImportId,
        staffingPreflight.baselineImportId,
      ),
    );
    statements.push(
      auditInsertStatement(
        c.env.DB,
        {
          bidSessionId: null,
          actorType: 'admin',
          actorId,
          action: 'rule_book_clone', // existing enum value; covers publish
          targetKind: 'rule_book',
          targetId: version,
          reason,
          afterState: { effective_year: target.effectiveYear, status: 'active' },
        },
        now,
      ),
    );
    const results = await c.env.DB.batch(statements);
    const publishResult = results[results.length - 2];
    const auditResult = results[results.length - 1];
    if (publishResult?.meta.changes !== 1 || auditResult?.meta.changes !== 1) {
      return c.json({ error: 'rule_book_status_changed' }, 409);
    }

    return c.json({
      version,
      status: 'active',
      published_at: now.toISOString(),
      validation: {
        expected_biddable_position_count: coverage.expectedBiddablePositionIds.length,
        valid_bid_rule_count: coverage.validRulePositionIds.length,
        missing_biddable_rules: coverage.missingBiddablePositionIds.length,
        non_biddable_rules_present: coverage.nonBiddablePositionIds.length,
        duplicate_rules: coverage.duplicatePositionIds.length,
        unexpected_rule_differences: coverage.unexpectedPositionIds.length,
      },
    });
  },
);

export default router;

import { zValidator } from '@hono/zod-validator';
import {
  type BidConfigurationSettingsV2,
  BidConfigurationSettingsV2Schema,
  type BidConfigurationSettingsV3,
  BidConfigurationSettingsV3Schema,
  CredentialEvaluationDateSchema,
  FrozenLiveBidPolicySchema,
  type JwtPayload,
} from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getDb } from '../../db/index.js';
import { annualBidPolicyDocuments, bidYears, ruleBooks } from '../../db/schema.js';
import { auditInsertStatement } from '../../lib/audit.js';
import { loadRuleBookCoverage, parseBidConfigurationSettings } from '../../lib/bid-policy.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const YearParamSchema = z.coerce.number().int().min(2024).max(2100);
const SetBidConfigurationSchema = z
  .object({
    rule_book_version: z
      .string()
      .trim()
      .regex(/^\d{4}\.\d+$/),
    annual_policy_document_id: z.string().trim().min(1).optional(),
    expected_configuration_revision: z.number().int().nonnegative(),
    settings: z
      .object({
        expected_duration_days: z.number().int().min(1).max(7),
        turn_timer_seconds: z.number().int().min(30).max(600),
        credential_evaluation_on: CredentialEvaluationDateSchema,
      })
      .strict(),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

type ConfigurationLifecycle =
  | 'UNCONFIGURED'
  | 'DRAFT'
  | 'FROZEN'
  | 'LEGACY_EVALUATION_DATE_REQUIRED'
  | 'INCONSISTENT';

function actorIdFromClaims(claims: JwtPayload): number | null {
  return claims.member_id;
}

function configurationResponse(
  year: {
    year: number;
    status: 'configuring' | 'live' | 'paused' | 'complete' | 'archived';
    ruleBookVersion: string | null;
    positionTemplateVersion: string | null;
    configJson: string | null;
    configurationRevision: number;
    annualPolicyDocumentId?: string | null;
  },
  book:
    | {
        version: string;
        effectiveYear: number;
        status: 'draft' | 'active' | 'archived';
        revision: number;
      }
    | undefined,
) {
  const settings = parseBidConfigurationSettings(year.configJson);
  let lifecycle: ConfigurationLifecycle = 'INCONSISTENT';
  if (year.ruleBookVersion === null && year.positionTemplateVersion === null && settings === null) {
    lifecycle = 'UNCONFIGURED';
  } else if (
    book !== undefined &&
    book.effectiveYear === year.year &&
    year.positionTemplateVersion !== null &&
    settings !== null
  ) {
    if (settings.v === 1) {
      lifecycle = 'LEGACY_EVALUATION_DATE_REQUIRED';
    } else {
      lifecycle =
        book.status === 'draft' ? 'DRAFT' : book.status === 'active' ? 'FROZEN' : 'INCONSISTENT';
    }
  }

  return {
    bidYear: year.year,
    bidYearStatus: year.status,
    ruleBookVersion: year.ruleBookVersion,
    positionTemplateVersion: year.positionTemplateVersion,
    configurationRevision: year.configurationRevision,
    annualPolicyDocumentId: year.annualPolicyDocumentId ?? null,
    ruleBookRevision: book?.revision ?? null,
    settings,
    lifecycle,
  };
}

const router = new Hono<Env>();
router.use('*', requireAdmin);

/**
 * GET /api/admin/bid-configuration/:year
 *
 * Read-only configuration source for the year. It intentionally exposes only
 * normalized rule-book/template identifiers and supported timers, never raw
 * `config_json` or any personnel/staffing data.
 */
router.get('/:year', async (c) => {
  const parsedYear = YearParamSchema.safeParse(c.req.param('year'));
  if (!parsedYear.success) return c.json({ error: 'invalid_bid_year' }, 400);
  const db = getDb(c.env.DB);
  const year = await db.select().from(bidYears).where(eq(bidYears.year, parsedYear.data)).get();
  if (year === undefined) return c.json({ error: 'not_found' }, 404);
  const book =
    year.ruleBookVersion === null
      ? undefined
      : await db
          .select({
            version: ruleBooks.version,
            effectiveYear: ruleBooks.effectiveYear,
            status: ruleBooks.status,
            revision: ruleBooks.revision,
          })
          .from(ruleBooks)
          .where(eq(ruleBooks.version, year.ruleBookVersion))
          .get();
  return c.json({ configuration: configurationResponse(year, book) });
});

/**
 * PUT /api/admin/bid-configuration/:year
 *
 * Designates the one editable draft that subsequent mocks must snapshot. The
 * route is step-up protected, optimistic-concurrency guarded, and cannot
 * replace a frozen/active designation only while the year is still configuring
 * and no real session history exists.
 */
router.put(
  '/:year',
  requireStepUpAuth(),
  zValidator('json', SetBidConfigurationSchema),
  async (c) => {
    const parsedYear = YearParamSchema.safeParse(c.req.param('year'));
    if (!parsedYear.success) return c.json({ error: 'invalid_bid_year' }, 400);
    const body = c.req.valid('json');
    const baseSettings = BidConfigurationSettingsV2Schema.parse({
      v: 2,
      expectedDurationDays: body.settings.expected_duration_days,
      turnTimerSeconds: body.settings.turn_timer_seconds,
      credentialEvaluationOn: body.settings.credential_evaluation_on,
    });
    const db = getDb(c.env.DB);
    const year = await db.select().from(bidYears).where(eq(bidYears.year, parsedYear.data)).get();
    if (year === undefined) return c.json({ error: 'not_found' }, 404);
    if (year.status !== 'configuring') {
      return c.json({ error: 'bid_configuration_not_configuring', status: year.status }, 409);
    }
    if (year.configurationRevision !== body.expected_configuration_revision) {
      return c.json({ error: 'bid_configuration_changed' }, 409);
    }

    const [currentBook, candidateBook, policyDocument] = await Promise.all([
      year.ruleBookVersion === null
        ? Promise.resolve(undefined)
        : db
            .select({
              version: ruleBooks.version,
              effectiveYear: ruleBooks.effectiveYear,
              status: ruleBooks.status,
              revision: ruleBooks.revision,
            })
            .from(ruleBooks)
            .where(eq(ruleBooks.version, year.ruleBookVersion))
            .get(),
      db
        .select({
          version: ruleBooks.version,
          effectiveYear: ruleBooks.effectiveYear,
          status: ruleBooks.status,
          revision: ruleBooks.revision,
        })
        .from(ruleBooks)
        .where(eq(ruleBooks.version, body.rule_book_version))
        .get(),
      body.annual_policy_document_id === undefined
        ? Promise.resolve(undefined)
        : db
            .select()
            .from(annualBidPolicyDocuments)
            .where(eq(annualBidPolicyDocuments.id, body.annual_policy_document_id))
            .get(),
    ]);
    if (currentBook?.status === 'active') {
      const realSession = await c.env.DB.prepare(
        'SELECT 1 AS present FROM bid_sessions WHERE bid_year = ? AND is_mock = 0 LIMIT 1',
      )
        .bind(parsedYear.data)
        .first<{ present: number }>();
      if (realSession !== null) {
        return c.json({ error: 'bid_configuration_real_session_exists' }, 409);
      }
    }
    if (candidateBook === undefined) return c.json({ error: 'rule_book_not_found' }, 404);
    if (candidateBook.effectiveYear !== parsedYear.data) {
      return c.json({ error: 'rule_book_year_mismatch' }, 409);
    }
    if (candidateBook.status !== 'draft') {
      return c.json(
        { error: 'bid_configuration_draft_required', status: candidateBook.status },
        409,
      );
    }
    if (body.annual_policy_document_id !== undefined) {
      if (policyDocument === undefined)
        return c.json({ error: 'annual_policy_document_not_found' }, 404);
      if (
        policyDocument.effectiveYear !== parsedYear.data ||
        policyDocument.ruleBookVersion !== candidateBook.version
      )
        return c.json({ error: 'annual_policy_document_configuration_mismatch' }, 409);
      if (policyDocument.status === 'SUPERSEDED')
        return c.json({ error: 'annual_policy_document_superseded' }, 409);
    }
    let settings: BidConfigurationSettingsV2 | BidConfigurationSettingsV3 = baseSettings;
    if (policyDocument !== undefined) {
      let executionPolicyJson: unknown;
      try {
        executionPolicyJson = JSON.parse(policyDocument.executionPolicyJson) as unknown;
      } catch {
        return c.json({ error: 'annual_policy_execution_invalid' }, 409);
      }
      const executionPolicy = FrozenLiveBidPolicySchema.safeParse(executionPolicyJson);
      if (!executionPolicy.success)
        return c.json({ error: 'annual_policy_execution_invalid' }, 409);
      settings = BidConfigurationSettingsV3Schema.parse({
        v: 3,
        expectedDurationDays: baseSettings.expectedDurationDays,
        turnTimerSeconds: baseSettings.turnTimerSeconds,
        credentialEvaluationOn: baseSettings.credentialEvaluationOn,
        livePolicy: executionPolicy.data,
      });
    }
    const coverage = await loadRuleBookCoverage(db, candidateBook.version);
    if (!coverage.valid || coverage.templateVersion === null) {
      return c.json(
        {
          error: 'rule_book_invalid',
          invalid_position_ids: coverage.invalidPositionIds,
          duplicate_position_ids: coverage.duplicatePositionIds,
          missing_biddable_position_ids: coverage.missingBiddablePositionIds,
          non_biddable_position_ids: coverage.nonBiddablePositionIds,
          unexpected_position_ids: coverage.unexpectedPositionIds,
        },
        409,
      );
    }

    // The candidate revision is captured in the write predicate. A concurrent
    // draft edit or a concurrent configuration selection leaves this request
    // with zero changes rather than silently selecting an unreviewed state.
    const mutationStatement = c.env.DB.prepare(
      `UPDATE bid_years
          SET rule_book_version = ?,
              position_template_version = ?,
              annual_policy_document_id = ?,
              config_json = ?,
              configuration_revision = configuration_revision + 1
        WHERE year = ?
          AND status = 'configuring'
          AND configuration_revision = ?
          AND (
            NOT EXISTS (
              SELECT 1
              FROM rule_books configured_book
              WHERE configured_book.version = bid_years.rule_book_version
                AND configured_book.status = 'active'
            )
            OR NOT EXISTS (
              SELECT 1
              FROM bid_sessions real_session
              WHERE real_session.bid_year = bid_years.year
                AND real_session.is_mock = 0
            )
          )
          AND EXISTS (
            SELECT 1
            FROM rule_books candidate_book
            WHERE candidate_book.version = ?
              AND candidate_book.effective_year = ?
              AND candidate_book.status = 'draft'
              AND candidate_book.revision = ?
          )
          AND (
            ? IS NULL OR EXISTS (
              SELECT 1 FROM annual_bid_policy_documents policy_document
              WHERE policy_document.id = ?
                AND policy_document.rule_book_version = ?
                AND policy_document.effective_year = ?
                AND policy_document.status != 'SUPERSEDED'
            )
          )`,
    ).bind(
      candidateBook.version,
      coverage.templateVersion,
      policyDocument?.id ?? null,
      JSON.stringify(settings),
      parsedYear.data,
      body.expected_configuration_revision,
      candidateBook.version,
      parsedYear.data,
      candidateBook.revision,
      policyDocument?.id ?? null,
      policyDocument?.id ?? null,
      candidateBook.version,
      parsedYear.data,
    );
    const anticipated = {
      ...year,
      ruleBookVersion: candidateBook.version,
      positionTemplateVersion: coverage.templateVersion,
      annualPolicyDocumentId: policyDocument?.id ?? null,
      configJson: JSON.stringify(settings),
      configurationRevision: year.configurationRevision + 1,
    };
    const results = await c.env.DB.batch([
      mutationStatement,
      auditInsertStatement(c.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: actorIdFromClaims(c.get('claims')),
        action: 'bid_configuration_set',
        targetKind: 'bid_year',
        targetId: String(parsedYear.data),
        reason: body.reason,
        beforeState: configurationResponse(year, currentBook),
        afterState: configurationResponse(anticipated, candidateBook),
      }),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      const current = await db
        .select()
        .from(bidYears)
        .where(eq(bidYears.year, parsedYear.data))
        .get();
      if (current !== undefined && current.ruleBookVersion !== null) {
        const currentTarget = await db
          .select({ status: ruleBooks.status })
          .from(ruleBooks)
          .where(eq(ruleBooks.version, current.ruleBookVersion))
          .get();
        if (currentTarget?.status === 'active') {
          const realSession = await c.env.DB.prepare(
            'SELECT 1 AS present FROM bid_sessions WHERE bid_year = ? AND is_mock = 0 LIMIT 1',
          )
            .bind(parsedYear.data)
            .first<{ present: number }>();
          if (realSession !== null)
            return c.json({ error: 'bid_configuration_real_session_exists' }, 409);
        }
      }
      return c.json({ error: 'bid_configuration_changed' }, 409);
    }

    return c.json({ configuration: configurationResponse(anticipated, candidateBook) });
  },
);

export default router;

import { zValidator } from '@hono/zod-validator';
import {
  BidConfigurationSettingsV3Schema,
  FrozenLiveBidPolicySchema,
  type JwtPayload,
} from '@mbfd/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';

import { getDb } from '../../db/index.js';
import { annualBidPolicyDocuments, bidYears, ruleBooks } from '../../db/schema.js';
import {
  configurationReceiptStatement,
  loadConfigurationReceipt,
} from '../../lib/admin-configuration-receipt.js';
import { auditInsertStatement } from '../../lib/audit.js';
import {
  parseBidConfigurationSettings,
  prepareBidSessionPolicySnapshot,
  validateAnnualPolicySourceReferences,
} from '../../lib/bid-policy.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const YearSchema = z.coerce.number().int().min(2024).max(2100);
const DraftDocumentSchema = z
  .object({
    rule_book_version: z
      .string()
      .trim()
      .regex(/^\d{4}\.\d+$/),
    policy_text: z.string().trim().min(20).max(100_000),
    execution_policy: FrozenLiveBidPolicySchema,
    expected_configuration_revision: z.number().int().nonnegative().optional(),
    expected_rule_book_revision: z.number().int().nonnegative().optional(),
    expected_source_revision: z.number().int().nonnegative().optional(),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

const PublishDocumentSchema = z
  .object({
    reason: z.string().trim().min(4).max(500),
    expected_configuration_revision: z.number().int().nonnegative().optional(),
    expected_document_revision: z.number().int().positive().optional(),
  })
  .strict();

const router = new Hono<Env>();
router.use('*', requireAdmin);

/** Real source/frozen-policy options for the no-code editor. */
router.get('/:year/editor-data', async (c) => {
  const year = YearSchema.safeParse(c.req.param('year'));
  if (!year.success) return c.json({ error: 'invalid_bid_year' }, 400);
  const sourceBefore = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  const prepared = await prepareBidSessionPolicySnapshot(
    getDb(c.env.DB),
    year.data,
    Date.now(),
    'mock',
  );
  if (!prepared.ok)
    return c.json({ error: 'annual_policy_source_unavailable', policy_error: prepared.code }, 409);
  const sourceAfter = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  if (sourceBefore?.revision !== sourceAfter?.revision)
    return c.json({ error: 'annual_policy_source_changed' }, 409);
  const identities = new Map(
    (prepared.snapshot.operatorIdentityProjection ?? []).map((identity) => [
      identity.memberId,
      identity,
    ]),
  );
  return c.json({
    rule_book_version: prepared.snapshot.ruleBookVersion,
    rule_book_revision: prepared.snapshot.ruleBookRevision,
    source_revision: sourceAfter?.revision,
    managed_annual_plan: !!(await c.env.DB.prepare(
      'SELECT bid_year FROM annual_plan_reviews WHERE bid_year=?',
    )
      .bind(year.data)
      .first()),
    configuration_revision: prepared.snapshot.configurationRevision,
    credential_evaluation_on: prepared.snapshot.credentialEvaluationOn,
    members: prepared.snapshot.members.map((member) => ({
      member_id: member.memberId,
      first_name: identities.get(member.memberId)?.firstName ?? '',
      last_name: identities.get(member.memberId)?.lastName ?? '',
      rank: member.rank,
      pool: member.pool,
      rsc_seniority: member.rscSeniority,
      rank_seniority: member.rankSeniority,
      credential_names: member.credentialNames,
      specialty_qualification_codes: (member.specialtyQualifications ?? []).map(
        (qualification) => qualification.specialtyCode,
      ),
    })),
    positions: prepared.snapshot.ruleBookMaterial.positions
      .filter((position) => prepared.coverage.rules.some((rule) => rule.positionId === position.id))
      .map((position) => ({
        id: position.id,
        shift: position.shift,
        station: position.station,
        unit: position.unit,
        rank_required: position.rankRequired,
        position_name: position.positionName,
      })),
  });
});

/** Returns language and parsed policy material; no personnel or credential evidence is exposed. */
router.get('/:year', async (c) => {
  const year = YearSchema.safeParse(c.req.param('year'));
  if (!year.success) return c.json({ error: 'invalid_bid_year' }, 400);
  const db = getDb(c.env.DB);
  const documents = await db
    .select()
    .from(annualBidPolicyDocuments)
    .where(eq(annualBidPolicyDocuments.effectiveYear, year.data))
    .orderBy(desc(annualBidPolicyDocuments.revision))
    .all();
  return c.json({
    documents: documents.map((document) => ({
      id: document.id,
      rule_book_version: document.ruleBookVersion,
      effective_year: document.effectiveYear,
      revision: document.revision,
      status: document.status,
      policy_text: document.policyText,
      execution_policy: JSON.parse(document.executionPolicyJson) as unknown,
      created_at: document.createdAt,
      updated_at: document.updatedAt,
      published_at: document.publishedAt,
      supersedes_document_id: document.supersedesDocumentId,
    })),
  });
});

/** A fresh draft is the only edit path; published language can only be superseded. */
router.post('/:year', requireStepUpAuth(), zValidator('json', DraftDocumentSchema), async (c) => {
  const year = YearSchema.safeParse(c.req.param('year'));
  if (!year.success) return c.json({ error: 'invalid_bid_year' }, 400);
  const body = c.req.valid('json');
  const key = c.req.header('Idempotency-Key');
  if (key !== undefined && (!key || key !== key.trim() || key.length > 256))
    return c.json({ error: 'invalid_idempotency_key' }, 400);
  const receiptInput = {
    key: key ?? '',
    actorSubject: String(c.get('claims').sub),
    operation: `annual-policy.create:${year.data}`,
    request: body,
  };
  if (key) {
    const prior = await loadConfigurationReceipt(c.env.DB, receiptInput);
    if (prior)
      return prior.ok
        ? c.json({ ...prior.response, replayed: true })
        : c.json({ error: prior.error }, 409);
    if (
      body.expected_configuration_revision === undefined ||
      body.expected_rule_book_revision === undefined ||
      body.expected_source_revision === undefined
    )
      return c.json({ error: 'expected_revisions_required' }, 400);
  }
  const db = getDb(c.env.DB);
  const [bidYear, ruleBook, previousPublished] = await Promise.all([
    db.select().from(bidYears).where(eq(bidYears.year, year.data)).get(),
    db.select().from(ruleBooks).where(eq(ruleBooks.version, body.rule_book_version)).get(),
    db
      .select({ id: annualBidPolicyDocuments.id })
      .from(annualBidPolicyDocuments)
      .where(
        and(
          eq(annualBidPolicyDocuments.ruleBookVersion, body.rule_book_version),
          eq(annualBidPolicyDocuments.status, 'PUBLISHED'),
        ),
      )
      .get(),
  ]);
  if (bidYear === undefined) return c.json({ error: 'bid_year_not_found' }, 404);
  if (bidYear.status !== 'configuring')
    return c.json({ error: 'annual_policy_year_not_configuring' }, 409);
  if (ruleBook === undefined) return c.json({ error: 'rule_book_not_found' }, 404);
  if (ruleBook.effectiveYear !== year.data)
    return c.json({ error: 'rule_book_year_mismatch' }, 409);
  if (ruleBook.status !== 'draft')
    return c.json({ error: 'annual_policy_requires_draft_rule_book' }, 409);
  const sourceGeneration = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  if (
    (body.expected_configuration_revision !== undefined &&
      body.expected_configuration_revision !== bidYear.configurationRevision) ||
    (body.expected_rule_book_revision !== undefined &&
      body.expected_rule_book_revision !== ruleBook.revision) ||
    (body.expected_source_revision !== undefined &&
      body.expected_source_revision !== sourceGeneration?.revision)
  )
    return c.json({ error: 'annual_policy_or_source_changed' }, 409);
  const prepared = await prepareBidSessionPolicySnapshot(db, year.data, Date.now(), 'mock');
  if (!prepared.ok)
    return c.json({ error: 'annual_policy_source_unavailable', policy_error: prepared.code }, 409);
  if (prepared.snapshot.ruleBookVersion !== body.rule_book_version)
    return c.json({ error: 'annual_policy_rule_book_not_configured' }, 409);
  const sourceErrors = validateAnnualPolicySourceReferences(
    prepared.snapshot,
    body.execution_policy,
  );
  if (sourceErrors.length > 0)
    return c.json(
      { error: 'annual_policy_source_validation_failed', validation_errors: sourceErrors },
      409,
    );
  const currentSettings = parseBidConfigurationSettings(bidYear.configJson);
  if (currentSettings === null || currentSettings.v === 1)
    return c.json({ error: 'annual_policy_configuration_required' }, 409);
  const settings = BidConfigurationSettingsV3Schema.parse({
    v: 3,
    expectedDurationDays: currentSettings.expectedDurationDays,
    turnTimerSeconds: currentSettings.turnTimerSeconds,
    credentialEvaluationOn: currentSettings.credentialEvaluationOn,
    ...(currentSettings.personnelEvaluationOn
      ? { personnelEvaluationOn: currentSettings.personnelEvaluationOn }
      : {}),
    livePolicy: body.execution_policy,
  });
  const now = Date.now();
  const id = ulid();
  const latest = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(revision),0) AS revision FROM annual_bid_policy_documents WHERE rule_book_version=?',
  )
    .bind(body.rule_book_version)
    .first<{ revision: number }>();
  const nextRevision = (latest?.revision ?? 0) + 1;
  const responseBody = { id, revision: nextRevision, status: 'DRAFT' };
  let result: D1Result[];
  try {
    result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO annual_bid_policy_documents
          (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at,supersedes_document_id)
         SELECT ?,?,?,COALESCE(MAX(revision), 0) + 1,'DRAFT',?,?,?,?,?,?
           FROM annual_bid_policy_documents
          WHERE rule_book_version = ?
          HAVING COALESCE(MAX(revision),0)=? AND EXISTS(SELECT 1 FROM bid_years y JOIN rule_books b ON b.version=y.rule_book_version WHERE y.year=? AND y.status='configuring' AND y.configuration_revision=? AND b.version=? AND b.status='draft' AND b.revision=?) AND (SELECT revision FROM annual_source_revision WHERE id=1)=?`,
      ).bind(
        id,
        body.rule_book_version,
        year.data,
        body.policy_text,
        JSON.stringify(body.execution_policy),
        c.get('claims').member_id,
        now,
        now,
        previousPublished?.id ?? null,
        body.rule_book_version,
        nextRevision - 1,
        year.data,
        bidYear.configurationRevision,
        body.rule_book_version,
        ruleBook.revision,
        sourceGeneration?.revision ?? -1,
      ),
      c.env.DB.prepare(
        `UPDATE bid_years
            SET annual_policy_document_id = ?, config_json = ?,
                configuration_revision = configuration_revision + 1
          WHERE year = ? AND status = 'configuring'
            AND rule_book_version = ?
            AND EXISTS (
              SELECT 1 FROM annual_bid_policy_documents
              WHERE id = ? AND status = 'DRAFT'
            )`,
      ).bind(id, JSON.stringify(settings), year.data, body.rule_book_version, id),
      auditInsertStatement(
        c.env.DB,
        {
          bidSessionId: null,
          actorType: 'admin',
          actorId: c.get('claims').member_id,
          action: 'bid_configuration_set',
          targetKind: 'annual_policy_document',
          targetId: id,
          afterState: { effective_year: year.data, rule_book_version: body.rule_book_version },
          reason: body.reason,
        },
        new Date(),
        true,
      ),
      ...(key ? [configurationReceiptStatement(c.env.DB, receiptInput, responseBody)] : []),
    ]);
  } catch (error) {
    const prior = key ? await loadConfigurationReceipt(c.env.DB, receiptInput) : null;
    if (prior)
      return prior.ok
        ? c.json({ ...prior.response, replayed: true })
        : c.json({ error: prior.error }, 409);
    if (error instanceof Error && /constraint|unique/i.test(error.message))
      return c.json({ error: 'annual_policy_changed' }, 409);
    throw error;
  }
  if (
    result[0]?.meta.changes !== 1 ||
    result[1]?.meta.changes !== 1 ||
    result[2]?.meta.changes !== 1
  )
    return c.json({ error: 'annual_policy_changed' }, 409);
  const document = await db
    .select({ revision: annualBidPolicyDocuments.revision })
    .from(annualBidPolicyDocuments)
    .where(eq(annualBidPolicyDocuments.id, id))
    .get();
  if (document === undefined) return c.json({ error: 'annual_policy_changed' }, 409);
  return c.json(
    {
      id,
      revision: document.revision,
      status: 'DRAFT',
    },
    201,
  );
});

/** Publishes one immutable revision and atomically retires any prior published revision. */
router.post(
  '/:year/:id/publish',
  requireStepUpAuth(),
  zValidator('json', PublishDocumentSchema),
  async (c) => {
    const year = YearSchema.safeParse(c.req.param('year'));
    if (!year.success) return c.json({ error: 'invalid_bid_year' }, 400);
    const body = c.req.valid('json');
    const key = c.req.header('Idempotency-Key');
    if (key !== undefined && (!key || key !== key.trim() || key.length > 256))
      return c.json({ error: 'invalid_idempotency_key' }, 400);
    const receiptInput = {
      key: key ?? '',
      actorSubject: String(c.get('claims').sub),
      operation: `annual-policy.publish:${year.data}:${c.req.param('id')}`,
      request: body,
    };
    if (key) {
      const prior = await loadConfigurationReceipt(c.env.DB, receiptInput);
      if (prior)
        return prior.ok
          ? c.json({ ...prior.response, replayed: true })
          : c.json({ error: prior.error }, 409);
      if (
        body.expected_configuration_revision === undefined ||
        body.expected_document_revision === undefined
      )
        return c.json({ error: 'expected_revisions_required' }, 400);
    }
    if (
      await c.env.DB.prepare('SELECT bid_year FROM annual_plan_reviews WHERE bid_year=?')
        .bind(year.data)
        .first()
    )
      return c.json({ error: 'managed_annual_plan_freeze_required' }, 409);
    const db = getDb(c.env.DB);
    const document = await db
      .select()
      .from(annualBidPolicyDocuments)
      .where(
        and(
          eq(annualBidPolicyDocuments.id, c.req.param('id')),
          eq(annualBidPolicyDocuments.effectiveYear, year.data),
        ),
      )
      .get();
    if (document === undefined) return c.json({ error: 'annual_policy_document_not_found' }, 404);
    if (document.status !== 'DRAFT')
      return c.json({ error: 'annual_policy_document_not_draft' }, 409);
    const bidYear = await db.select().from(bidYears).where(eq(bidYears.year, year.data)).get();
    if (bidYear === undefined) return c.json({ error: 'bid_year_not_found' }, 404);
    if (bidYear.status !== 'configuring')
      return c.json({ error: 'annual_policy_year_not_configuring' }, 409);
    if (bidYear.annualPolicyDocumentId !== document.id)
      return c.json({ error: 'annual_policy_document_not_configured' }, 409);
    if (
      (body.expected_document_revision !== undefined &&
        body.expected_document_revision !== document.revision) ||
      (body.expected_configuration_revision !== undefined &&
        body.expected_configuration_revision !== bidYear.configurationRevision)
    )
      return c.json({ error: 'annual_policy_changed' }, 409);
    const now = Date.now();
    const responseBody = { id: document.id, revision: document.revision, status: 'PUBLISHED' };
    let results: D1Result[];
    try {
      results = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE annual_bid_policy_documents
           SET status = 'SUPERSEDED', updated_at = ?
         WHERE rule_book_version = ? AND status = 'PUBLISHED' AND id != ? AND EXISTS(SELECT 1 FROM bid_years WHERE year=? AND annual_policy_document_id=? AND configuration_revision=? AND status='configuring')`,
        ).bind(
          now,
          document.ruleBookVersion,
          document.id,
          year.data,
          document.id,
          bidYear.configurationRevision,
        ),
        c.env.DB.prepare(
          `UPDATE annual_bid_policy_documents
           SET status = 'PUBLISHED', published_by = ?, published_at = ?, updated_at = ?
         WHERE id = ? AND effective_year = ? AND status = 'DRAFT' AND revision=? AND EXISTS(SELECT 1 FROM bid_years WHERE year=? AND annual_policy_document_id=? AND configuration_revision=? AND status='configuring')`,
        ).bind(
          c.get('claims').member_id,
          now,
          now,
          document.id,
          year.data,
          document.revision,
          year.data,
          document.id,
          bidYear.configurationRevision,
        ),
        auditInsertStatement(
          c.env.DB,
          {
            bidSessionId: null,
            actorType: 'admin',
            actorId: c.get('claims').member_id,
            action: 'annual_policy_published',
            targetKind: 'annual_policy_document',
            targetId: document.id,
            afterState: {
              effective_year: year.data,
              rule_book_version: document.ruleBookVersion,
              revision: document.revision,
              supersedes_document_id: document.supersedesDocumentId,
            },
            reason: body.reason,
          },
          new Date(),
          true,
        ),
        ...(key ? [configurationReceiptStatement(c.env.DB, receiptInput, responseBody)] : []),
      ]);
    } catch {
      const prior = key ? await loadConfigurationReceipt(c.env.DB, receiptInput) : null;
      if (prior)
        return prior.ok
          ? c.json({ ...prior.response, replayed: true })
          : c.json({ error: prior.error }, 409);
      return c.json({ error: 'annual_policy_changed' }, 409);
    }
    if (results[1]?.meta.changes !== 1 || results[2]?.meta.changes !== 1)
      return c.json({ error: 'annual_policy_changed' }, 409);
    return c.json(responseBody);
  },
);

export default router;

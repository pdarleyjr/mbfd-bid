import { zValidator } from '@hono/zod-validator';
import { FrozenLiveBidPolicySchema, type JwtPayload } from '@mbfd/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';

import { getDb } from '../../db/index.js';
import { annualBidPolicyDocuments, bidYears, ruleBooks } from '../../db/schema.js';
import { auditInsertStatement } from '../../lib/audit.js';
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
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

const PublishDocumentSchema = z.object({ reason: z.string().trim().min(4).max(500) }).strict();

const router = new Hono<Env>();
router.use('*', requireAdmin);

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
  const now = Date.now();
  const id = ulid();
  let result: D1Result[];
  try {
    result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO annual_bid_policy_documents
          (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at,supersedes_document_id)
         SELECT ?,?,?,COALESCE(MAX(revision), 0) + 1,'DRAFT',?,?,?,?,?,?
           FROM annual_bid_policy_documents
          WHERE rule_book_version = ?`,
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
      ),
      auditInsertStatement(c.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'bid_configuration_set',
        targetKind: 'annual_policy_document',
        targetId: id,
        afterState: { effective_year: year.data, rule_book_version: body.rule_book_version },
        reason: body.reason,
      }),
    ]);
  } catch (error) {
    if (error instanceof Error && /constraint|unique/i.test(error.message))
      return c.json({ error: 'annual_policy_changed' }, 409);
    throw error;
  }
  if (result[0]?.meta.changes !== 1) return c.json({ error: 'annual_policy_changed' }, 409);
  const document = await db
    .select({ revision: annualBidPolicyDocuments.revision })
    .from(annualBidPolicyDocuments)
    .where(eq(annualBidPolicyDocuments.id, id))
    .get();
  if (document === undefined) return c.json({ error: 'annual_policy_changed' }, 409);
  return c.json({ id, revision: document.revision, status: 'DRAFT' }, 201);
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
    const now = Date.now();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE annual_bid_policy_documents
           SET status = 'SUPERSEDED', updated_at = ?
         WHERE rule_book_version = ? AND status = 'PUBLISHED' AND id != ?`,
      ).bind(now, document.ruleBookVersion, document.id),
      c.env.DB.prepare(
        `UPDATE annual_bid_policy_documents
           SET status = 'PUBLISHED', published_by = ?, published_at = ?, updated_at = ?
         WHERE id = ? AND effective_year = ? AND status = 'DRAFT'`,
      ).bind(c.get('claims').member_id, now, now, document.id, year.data),
      auditInsertStatement(c.env.DB, {
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
      }),
    ]);
    if (results[1]?.meta.changes !== 1 || results[2]?.meta.changes !== 1)
      return c.json({ error: 'annual_policy_changed' }, 409);
    return c.json({ id: document.id, revision: document.revision, status: 'PUBLISHED' });
  },
);

export default router;

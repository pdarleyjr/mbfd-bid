import { zValidator } from '@hono/zod-validator';
import { evaluateEligibility } from '@mbfd/eligibility';
import { EligibilityPreviewSchema, type JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import {
  credentials,
  memberCredentials,
  memberQualificationEvents,
  members,
  positionRules,
} from '../../db/schema.js';
import {
  type EligibilityExportList,
  generateEligibilityPdf,
  generateEligibilityWorkbook,
} from '../../exports/eligibility-lists.js';
import {
  EligibilityListLoadError,
  loadAdminEligibilityListContext,
} from '../../lib/admin-eligibility-list.js';
import { operationalDate } from '../../lib/operational-date.js';
import { isIsoCalendarDate } from '../../lib/personnel-lifecycle.js';
import { decodeRuleBookRows } from '../../lib/position-rule.js';
import {
  activeCredentialNamesByMemberAsOf,
  completedCredentialNamesAsOf,
} from '../../lib/qualification-lifecycle.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

const EligibilityListQuerySchema = z
  .object({
    position_id: z.string().regex(/^[A-D]\d{3}$/),
    rule_book_version: z.string().regex(/^\d{4}\.\d+$/),
    as_of: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    bid_year: z.coerce.number().int().min(2024).max(2100).default(2026),
  })
  .strict();

const EligibilityExportQuerySchema = z
  .object({
    format: z.enum(['xlsx', 'pdf']),
    rule_book_version: z.string().regex(/^\d{4}\.\d+$/),
    as_of: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    bid_year: z.coerce.number().int().min(2024).max(2100).default(2026),
    position_id: z
      .string()
      .regex(/^[A-D]\d{3}$/)
      .optional(),
    scope: z.enum(['single', 'all']).default('single'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === 'single' && value.position_id === undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['position_id'], message: 'required' });
  });

router.get('/export', zValidator('query', EligibilityExportQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const asOf = query.as_of ?? operationalDate();
  if (!isIsoCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);
  const db = getDb(c.env.DB);
  let context: Awaited<ReturnType<typeof loadAdminEligibilityListContext>>;
  try {
    context = await loadAdminEligibilityListContext({
      db,
      ruleBookVersion: query.rule_book_version,
      asOf,
      bidYear: query.bid_year,
    });
  } catch (error) {
    if (error instanceof EligibilityListLoadError) return c.json(error.body, error.status);
    throw error;
  }
  const positionIds = query.scope === 'all' ? context.positionIds : [query.position_id as string];
  if (positionIds.length === 0) return c.json({ error: 'rule_book_empty' }, 409);
  if (positionIds.length > 250) return c.json({ error: 'export_position_limit_exceeded' }, 413);

  const lists: EligibilityExportList[] = [];
  try {
    for (const positionId of positionIds) lists.push(context.evaluate(positionId));
  } catch (error) {
    if (error instanceof EligibilityListLoadError) return c.json(error.body, error.status);
    throw error;
  }
  const stamp = asOf.replaceAll('-', '');
  const scope = query.scope === 'all' ? 'all-positions' : positionIds[0];
  if (query.format === 'xlsx') {
    const blob = await generateEligibilityWorkbook(lists);
    return new Response(blob, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="mbfd-eligibility-${scope}-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return new Response(generateEligibilityPdf(lists), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="mbfd-eligibility-${scope}-${stamp}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

router.get('/list', zValidator('query', EligibilityListQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const asOf = query.as_of ?? operationalDate();
  if (!isIsoCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);
  const db = getDb(c.env.DB);
  try {
    const context = await loadAdminEligibilityListContext({
      db,
      ruleBookVersion: query.rule_book_version,
      asOf,
      bidYear: query.bid_year,
    });
    return c.json(context.evaluate(query.position_id));
  } catch (error) {
    if (error instanceof EligibilityListLoadError) return c.json(error.body, error.status);
    throw error;
  }
});

router.post('/preview', zValidator('json', EligibilityPreviewSchema), async (c) => {
  const { member_id, position_id, rule_book_version, as_of: requestedAsOf } = c.req.valid('json');
  const db = getDb(c.env.DB);
  const asOf = requestedAsOf ?? operationalDate();
  if (!isIsoCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);

  // A preview has no bid-year/session context. Selecting an active rule book
  // globally would allow a new annual book to change an otherwise identical
  // preview request, so callers must name the configuration they intend.
  if (rule_book_version === undefined) {
    return c.json(
      {
        error: 'rule_book_version_required',
        configuration_required: true,
        rule_book_version_required: true,
      },
      409,
    );
  }

  const member = await db.select().from(members).where(eq(members.id, member_id)).get();
  if (member === undefined) return c.json({ error: 'member_not_found' }, 404);

  const [legacyCredentials, qualificationEvents] = await Promise.all([
    db
      .select({
        memberId: memberCredentials.memberId,
        credentialId: memberCredentials.credentialId,
        credentialName: credentials.name,
        startDate: memberCredentials.startDate,
        expirationDate: memberCredentials.expirationDate,
      })
      .from(memberCredentials)
      .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
      .where(eq(memberCredentials.memberId, member_id))
      .all(),
    db
      .select({
        id: memberQualificationEvents.id,
        memberId: memberQualificationEvents.memberId,
        credentialId: memberQualificationEvents.credentialId,
        credentialName: credentials.name,
        specialtyCode: memberQualificationEvents.specialtyCode,
        kind: memberQualificationEvents.kind,
        effectiveOn: memberQualificationEvents.effectiveOn,
        expiresOn: memberQualificationEvents.expiresOn,
        evidenceSource: memberQualificationEvents.evidenceSource,
        evidenceReference: memberQualificationEvents.evidenceReference,
        reason: memberQualificationEvents.reason,
        actorSubject: memberQualificationEvents.actorSubject,
        idempotencyKey: memberQualificationEvents.idempotencyKey,
        beforeState: memberQualificationEvents.beforeState,
        afterState: memberQualificationEvents.afterState,
        createdAt: memberQualificationEvents.createdAt,
      })
      .from(memberQualificationEvents)
      .leftJoin(credentials, eq(memberQualificationEvents.credentialId, credentials.id))
      .where(eq(memberQualificationEvents.memberId, member_id))
      .all(),
  ]);
  const credentialNames =
    activeCredentialNamesByMemberAsOf({
      asOf,
      legacyCredentials,
      events: qualificationEvents.map((event) => ({
        ...event,
        createdAt: event.createdAt.getTime(),
      })),
    }).get(member_id) ?? [];

  const version = rule_book_version;

  const ruleRows = await db
    .select()
    .from(positionRules)
    .where(eq(positionRules.ruleBookVersion, version))
    .all();
  const decodedRuleBook = decodeRuleBookRows(ruleRows);
  if (
    ruleRows.length === 0 ||
    decodedRuleBook.invalidPositionIds.length > 0 ||
    decodedRuleBook.duplicatePositionIds.length > 0
  ) {
    return c.json(
      {
        error: 'rule_book_invalid',
        empty_rule_book: ruleRows.length === 0,
        invalid_position_ids: decodedRuleBook.invalidPositionIds,
        duplicate_position_ids: decodedRuleBook.duplicatePositionIds,
      },
      409,
    );
  }
  const decodedRule = decodedRuleBook.rules.find((rule) => rule.positionId === position_id);
  if (decodedRule === undefined)
    return c.json({ error: 'rule_not_found', position_id, version }, 404);

  const result = evaluateEligibility(
    {
      employeeId: member.employeeId,
      firstName: member.firstName,
      lastName: member.lastName,
      rank: member.rank,
      rscSeniority: member.rscSeniority,
      rankSeniority: member.rankSeniority ?? undefined,
      isProbationary: member.isProbationary,
      credentials: credentialNames.map((name) => ({ name })),
      memberId: member.id,
      scoringEvidence: {
        evaluationOn: asOf,
        completedCredentialNames: completedCredentialNamesAsOf({
          memberId: member.id,
          asOf,
          legacyCredentials,
          events: qualificationEvents.map((e) => ({ ...e, createdAt: e.createdAt.getTime() })),
        }),
      },
    },
    decodedRule,
  );

  return c.json(result);
});

export default router;

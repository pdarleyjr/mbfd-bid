import { zValidator } from '@hono/zod-validator';
import { evaluateEligibility } from '@mbfd/eligibility';
import { EligibilityPreviewSchema, type JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { credentials, memberCredentials, members, positionRules } from '../../db/schema.js';
import { decodeRuleBookRows } from '../../lib/position-rule.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.post('/preview', zValidator('json', EligibilityPreviewSchema), async (c) => {
  const { member_id, position_id, rule_book_version } = c.req.valid('json');
  const db = getDb(c.env.DB);

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

  const creds = await db
    .select({ name: credentials.name })
    .from(memberCredentials)
    .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
    .where(eq(memberCredentials.memberId, member_id))
    .all();

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
      credentials: creds.map((c) => ({ name: c.name })),
    },
    decodedRule,
  );

  return c.json(result);
});

export default router;

import { zValidator } from '@hono/zod-validator';
import { evaluateEligibility } from '@mbfd/eligibility';
import { EligibilityPreviewSchema, type JwtPayload } from '@mbfd/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import {
  credentials,
  memberCredentials,
  members,
  positionRules,
  ruleBooks,
} from '../../db/schema.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.post('/preview', zValidator('json', EligibilityPreviewSchema), async (c) => {
  const { member_id, position_id, rule_book_version } = c.req.valid('json');
  const db = getDb(c.env.DB);

  const member = await db.select().from(members).where(eq(members.id, member_id)).get();
  if (member === undefined) return c.json({ error: 'member_not_found' }, 404);

  const creds = await db
    .select({ name: credentials.name })
    .from(memberCredentials)
    .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
    .where(eq(memberCredentials.memberId, member_id))
    .all();

  let version: string;
  if (rule_book_version !== undefined) {
    version = rule_book_version;
  } else {
    const active = await db.select().from(ruleBooks).where(eq(ruleBooks.status, 'active')).get();
    if (active === undefined) return c.json({ error: 'no_active_rule_book' }, 404);
    version = active.version;
  }

  const rule = await db
    .select()
    .from(positionRules)
    .where(
      and(eq(positionRules.positionId, position_id), eq(positionRules.ruleBookVersion, version)),
    )
    .get();
  if (rule === undefined) return c.json({ error: 'rule_not_found', position_id, version }, 404);

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
    {
      positionId: rule.positionId,
      ruleBookVersion: rule.ruleBookVersion,
      requiredCriteria: JSON.parse(rule.requiredCriteriaJson),
      pointsPreference: JSON.parse(rule.pointsPreferenceJson),
      tieBreakChain: JSON.parse(rule.tieBreakChainJson),
    },
  );

  return c.json(result);
});

export default router;

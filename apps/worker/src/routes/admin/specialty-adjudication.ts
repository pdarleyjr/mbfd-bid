import type { JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { hasCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { bidSessions } from '../../db/schema.js';
import { type FrozenSessionBidPolicy, loadFrozenSessionBidPolicy } from '../../lib/bid-policy.js';
import { SpecialtyTestPolicySchema } from '../../lib/specialty-test-policy.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const OpaqueIdSchema = z.string().trim().min(1).max(160);
const ClientEligibilitySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('eligible') }).strict(),
  z
    .object({
      status: z.literal('ineligible'),
      reason_codes: z.array(OpaqueIdSchema).min(1).max(30),
    })
    .strict(),
]);
const ClientPolicySchema = z
  .object({
    source: z.enum(['synthetic', 'official']),
    policy_reference: OpaqueIdSchema,
    test_policy: SpecialtyTestPolicySchema,
    candidate_release_policy: z.discriminatedUnion('status', [
      z
        .object({
          status: z.literal('configured'),
          on_release: z.enum(['continue_to_next_higher_priority', 'return_to_original_bidder']),
        })
        .strict(),
      z
        .object({ status: z.literal('unresolved'), reason: z.string().trim().min(1).max(500) })
        .strict(),
    ]),
    candidates: z
      .array(
        z
          .object({
            member_id: z.number().int().positive(),
            priority_rank: z.number().int().nonnegative(),
            general_eligibility: ClientEligibilitySchema,
            specialty_eligibility: ClientEligibilitySchema,
          })
          .strict(),
      )
      .min(1)
      .max(250),
  })
  .strict();
const BeginBodySchema = z
  .object({
    command_id: OpaqueIdSchema,
    expected_revision: z.number().int().nonnegative(),
    request_id: OpaqueIdSchema,
    position_id: OpaqueIdSchema,
    policy: ClientPolicySchema,
    reason: z.string().trim().min(4).max(500),
  })
  .strict();
const ClientOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('award'), award_reference: OpaqueIdSchema }).strict(),
  z
    .object({
      kind: z.literal('release'),
      reason: z.enum(['declined', 'unreachable', 'withdrawn', 'ineligible_on_recheck']),
    })
    .strict(),
]);
const CandidateBodySchema = z
  .object({
    command_id: OpaqueIdSchema,
    expected_revision: z.number().int().nonnegative(),
    request_id: OpaqueIdSchema,
    member_id: z.number().int().positive(),
    outcome: ClientOutcomeSchema,
    reason: z.string().trim().min(4).max(500),
  })
  .strict();
const OriginalBodySchema = z
  .object({
    command_id: OpaqueIdSchema,
    expected_revision: z.number().int().nonnegative(),
    request_id: OpaqueIdSchema,
    outcome: ClientOutcomeSchema,
    reason: z.string().trim().min(4).max(500),
  })
  .strict();
const ResumeBodySchema = z
  .object({
    command_id: OpaqueIdSchema,
    expected_revision: z.number().int().nonnegative(),
    request_id: OpaqueIdSchema,
    reason: z.string().trim().min(4).max(500),
  })
  .strict();

type FrozenPolicy = Extract<FrozenSessionBidPolicy, { ok: true }>;
type SyntheticSessionGuard =
  | {
      ok: true;
      frozen: FrozenPolicy;
    }
  | {
      ok: false;
      status: 404 | 409 | 503;
      body: Record<string, unknown>;
    };

/**
 * The current frozen V3 snapshot intentionally has no specialty ranking or
 * decline/recall model. This route therefore admits only a labelled synthetic
 * rehearsal against a mock session; it is never a live award command.
 */
async function guardSyntheticSpecialtySession(
  env: WorkerEnv,
  sessionId: string,
): Promise<SyntheticSessionGuard> {
  try {
    const db = getDb(env.DB);
    const session = await db
      .select({ id: bidSessions.id, isMock: bidSessions.isMock })
      .from(bidSessions)
      .where(eq(bidSessions.id, sessionId))
      .get();
    if (session === undefined)
      return { ok: false, status: 404, body: { error: 'session_not_found' } };
    if (!session.isMock) {
      return {
        ok: false,
        status: 409,
        body: { error: 'specialty_synthetic_test_mode_only', is_mock: false },
      };
    }
    if (await hasCanonicalBidSessionState(env.DB, sessionId)) {
      return {
        ok: false,
        status: 409,
        body: { error: 'canonical_mutation_requires_command' },
      };
    }
    const frozen = await loadFrozenSessionBidPolicy(db, sessionId);
    if (!frozen.ok) {
      return {
        ok: false,
        status: 409,
        body: {
          error: 'session_policy_snapshot_unavailable',
          policy_error: frozen.code,
        },
      };
    }
    return { ok: true, frozen };
  } catch {
    return { ok: false, status: 503, body: { error: 'bid_session_lookup_unavailable' } };
  }
}

function idempotencyHeaderMatches(
  c: { req: { header(name: string): string | undefined } },
  commandId: string,
) {
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (idempotencyKey === undefined || idempotencyKey === '')
    return 'missing_idempotency_key' as const;
  return idempotencyKey === commandId ? null : ('idempotency_key_mismatch' as const);
}

function auditContext(claims: JwtPayload, reason: string) {
  return {
    actorId: claims.sub,
    reason,
    origin: 'synthetic_specialty_test' as const,
    effectiveDate: null,
  };
}

function toEngineEligibility(
  eligibility: z.infer<typeof ClientEligibilitySchema>,
): { status: 'eligible' } | { status: 'ineligible'; reasonCodes: string[] } {
  return eligibility.status === 'eligible'
    ? { status: 'eligible' }
    : { status: 'ineligible', reasonCodes: eligibility.reason_codes };
}

function toEngineOutcome(outcome: z.infer<typeof ClientOutcomeSchema>) {
  return outcome.kind === 'award'
    ? { kind: 'award' as const, awardReference: outcome.award_reference }
    : { kind: 'release' as const, reason: outcome.reason };
}

function syntheticPolicyMatchesFrozenSession(
  frozen: FrozenPolicy,
  policy: z.infer<typeof ClientPolicySchema>,
): string | null {
  if (policy.source !== 'synthetic') return 'specialty_test_policy_must_be_synthetic';
  if (!policy.policy_reference.toLowerCase().startsWith('synthetic-')) {
    return 'synthetic_policy_reference_required';
  }
  if (policy.candidate_release_policy.status !== 'configured') {
    return 'synthetic_specialty_policy_unresolved';
  }
  const bidPoolMemberIds = new Set(
    frozen.snapshot.members
      .filter((member) => member.pool !== 'EXCLUDED')
      .map((member) => member.memberId),
  );
  if (policy.candidates.some((candidate) => !bidPoolMemberIds.has(candidate.member_id))) {
    return 'synthetic_candidate_not_in_frozen_bid_pool';
  }
  return null;
}

async function forwardToSpecialtyDO(
  env: WorkerEnv,
  sessionId: string,
  path: string,
  body?: string,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const doId = env.BID_SESSION.idFromName(sessionId);
  const response =
    body === undefined
      ? await env.BID_SESSION.get(doId).fetch(`https://do${path}`)
      : await env.BID_SESSION.get(doId).fetch(`https://do${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
  return {
    status: response.status,
    payload: (await response
      .json()
      .catch(() => ({ error: 'specialty_do_invalid_response' }))) as Record<string, unknown>,
  };
}

const router = new Hono<Env>();
router.use('*', requireAdmin);

// GET /api/admin/bid-session/:id/specialty-adjudication
router.get('/:id/specialty-adjudication', async (c) => {
  const sessionId = c.req.param('id');
  const guard = await guardSyntheticSpecialtySession(c.env, sessionId);
  if (!guard.ok) return c.json(guard.body, guard.status);
  const forwarded = await forwardToSpecialtyDO(c.env, sessionId, '/admin/specialty-adjudication');
  return c.json(forwarded.payload, forwarded.status as 200 | 400 | 409 | 500);
});

// POST /api/admin/bid-session/:id/specialty-adjudication/requests
router.post('/:id/specialty-adjudication/requests', requireStepUpAuth(), async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = BeginBodySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_payload' }, 400);
  const idemError = idempotencyHeaderMatches(c, parsed.data.command_id);
  if (idemError !== null) return c.json({ error: idemError }, 400);

  const sessionId = c.req.param('id');
  const guard = await guardSyntheticSpecialtySession(c.env, sessionId);
  if (!guard.ok) return c.json(guard.body, guard.status);
  const policyError = syntheticPolicyMatchesFrozenSession(guard.frozen, parsed.data.policy);
  if (policyError !== null) return c.json({ error: policyError }, 422);
  const releasePolicy = parsed.data.policy.candidate_release_policy;
  if (releasePolicy.status !== 'configured') {
    return c.json({ error: 'synthetic_specialty_policy_unresolved' }, 422);
  }
  if (!guard.frozen.coverage.rules.some((rule) => rule.positionId === parsed.data.position_id)) {
    return c.json({ error: 'position_not_biddable' }, 422);
  }

  const forwarded = await forwardToSpecialtyDO(
    c.env,
    sessionId,
    '/admin/specialty-adjudication/begin',
    JSON.stringify({
      command: {
        commandId: parsed.data.command_id,
        expectedRevision: parsed.data.expected_revision,
        requestId: parsed.data.request_id,
        positionId: parsed.data.position_id,
        policy: {
          policyReference: parsed.data.policy.policy_reference,
          source: 'synthetic',
          testPolicy: parsed.data.policy.test_policy,
          candidateReleasePolicy: {
            status: 'configured',
            onRelease: releasePolicy.on_release,
          },
          candidates: parsed.data.policy.candidates.map((candidate) => ({
            memberId: candidate.member_id,
            priorityRank: candidate.priority_rank,
            generalEligibility: toEngineEligibility(candidate.general_eligibility),
            specialtyEligibility: toEngineEligibility(candidate.specialty_eligibility),
          })),
        },
      },
      audit: auditContext(c.get('claims'), parsed.data.reason),
    }),
  );
  return c.json(forwarded.payload, forwarded.status as 200 | 400 | 409 | 500);
});

// POST /api/admin/bid-session/:id/specialty-adjudication/candidates
router.post('/:id/specialty-adjudication/candidates', requireStepUpAuth(), async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = CandidateBodySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_payload' }, 400);
  const idemError = idempotencyHeaderMatches(c, parsed.data.command_id);
  if (idemError !== null) return c.json({ error: idemError }, 400);

  const sessionId = c.req.param('id');
  const guard = await guardSyntheticSpecialtySession(c.env, sessionId);
  if (!guard.ok) return c.json(guard.body, guard.status);
  const forwarded = await forwardToSpecialtyDO(
    c.env,
    sessionId,
    '/admin/specialty-adjudication/resolve-candidate',
    JSON.stringify({
      command: {
        commandId: parsed.data.command_id,
        expectedRevision: parsed.data.expected_revision,
        requestId: parsed.data.request_id,
        memberId: parsed.data.member_id,
        outcome: toEngineOutcome(parsed.data.outcome),
      },
      audit: auditContext(c.get('claims'), parsed.data.reason),
    }),
  );
  return c.json(forwarded.payload, forwarded.status as 200 | 400 | 409 | 500);
});

// POST /api/admin/bid-session/:id/specialty-adjudication/original-request
router.post('/:id/specialty-adjudication/original-request', requireStepUpAuth(), async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = OriginalBodySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_payload' }, 400);
  const idemError = idempotencyHeaderMatches(c, parsed.data.command_id);
  if (idemError !== null) return c.json({ error: idemError }, 400);

  const sessionId = c.req.param('id');
  const guard = await guardSyntheticSpecialtySession(c.env, sessionId);
  if (!guard.ok) return c.json(guard.body, guard.status);
  const forwarded = await forwardToSpecialtyDO(
    c.env,
    sessionId,
    '/admin/specialty-adjudication/resolve-original',
    JSON.stringify({
      command: {
        commandId: parsed.data.command_id,
        expectedRevision: parsed.data.expected_revision,
        requestId: parsed.data.request_id,
        outcome: toEngineOutcome(parsed.data.outcome),
      },
      audit: auditContext(c.get('claims'), parsed.data.reason),
    }),
  );
  return c.json(forwarded.payload, forwarded.status as 200 | 400 | 409 | 500);
});

// POST /api/admin/bid-session/:id/specialty-adjudication/resume
router.post('/:id/specialty-adjudication/resume', requireStepUpAuth(), async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = ResumeBodySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_payload' }, 400);
  const idemError = idempotencyHeaderMatches(c, parsed.data.command_id);
  if (idemError !== null) return c.json({ error: idemError }, 400);

  const sessionId = c.req.param('id');
  const guard = await guardSyntheticSpecialtySession(c.env, sessionId);
  if (!guard.ok) return c.json(guard.body, guard.status);
  const forwarded = await forwardToSpecialtyDO(
    c.env,
    sessionId,
    '/admin/specialty-adjudication/resume',
    JSON.stringify({
      command: {
        commandId: parsed.data.command_id,
        expectedRevision: parsed.data.expected_revision,
        requestId: parsed.data.request_id,
      },
      audit: auditContext(c.get('claims'), parsed.data.reason),
    }),
  );
  return c.json(forwarded.payload, forwarded.status as 200 | 400 | 409 | 500);
});

export default router;

import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';

import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const ADVISORY_BOUNDARY = {
  advisoryOnly: true,
  mayCommitBid: false,
  mayMutatePolicy: false,
  mayMutateAssignments: false,
} as const;

function providerStatus(env: WorkerEnv) {
  const providerAvailable = env.AI !== undefined && env.AI_MODEL !== undefined;
  return {
    provider: providerAvailable ? 'Cloudflare Workers AI' : 'PENDING_CONFIGURATION',
    model: providerAvailable ? env.AI_MODEL : null,
    mode: providerAvailable ? 'advisory_ai' : 'deterministic_fallback',
    providerAvailable,
    ...ADVISORY_BOUNDARY,
  } as const;
}

const ReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _.:/-]*$/, 'reference contains unsupported characters');
const ReasonCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[A-Z0-9_:-]+$/);
const PolicyStateSchema = z.enum(['configured', 'unresolved']);

const ExplainSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('eligibility'),
      facts: z
        .object({
          subject_reference: ReferenceSchema,
          determination: z.enum(['eligible', 'ineligible']),
          reason_codes: z.array(ReasonCodeSchema).max(12),
          policy_reference: ReferenceSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('specialty_priority'),
      facts: z
        .object({
          requester_reference: ReferenceSchema,
          requester_priority: z.number().int().min(1).max(10_000),
          higher_priority_candidate_count: z.number().int().min(0).max(10_000),
          policy_reference: ReferenceSchema,
          policy_state: PolicyStateSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('available_options'),
      facts: z
        .object({
          subject_reference: ReferenceSchema,
          available_option_count: z.number().int().min(0).max(10_000),
          policy_reference: ReferenceSchema,
          blocked_reason_codes: z.array(ReasonCodeSchema).max(12),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('a_day'),
      facts: z
        .object({
          subject_reference: ReferenceSchema,
          available_option_count: z.number().int().min(0).max(10_000),
          policy_reference: ReferenceSchema,
          capacity_state: z.enum(['available', 'limited', 'unavailable', 'unresolved']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('teleStaff_conflict'),
      facts: z
        .object({
          source_snapshot_as_of: z.string().date(),
          current_record_newer: z.boolean(),
          resolution_state: z.enum([
            'requires_review',
            'kept_current',
            'accepted_source',
            'deferred',
          ]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('mock_summary'),
      facts: z
        .object({
          session_reference: ReferenceSchema,
          configuration_revision: z.number().int().nonnegative(),
          policy_reference: ReferenceSchema,
          bid_state: z.enum(['config', 'position_bid', 'a_day_bid', 'paused', 'complete']),
        })
        .strict(),
    })
    .strict(),
]);

type ExplainRequest = z.infer<typeof ExplainSchema>;

function deidentify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deidentify);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !key.endsWith('_reference'))
      .map(([key, item]) => [key, deidentify(item)]),
  );
}

async function providerExplanation(env: WorkerEnv, request: ExplainRequest): Promise<string> {
  if (env.AI === undefined || env.AI_MODEL === undefined) {
    throw new Error('provider unavailable');
  }
  const result = await env.AI.run(env.AI_MODEL, {
    messages: [
      {
        role: 'system',
        content:
          'Explain the supplied structured MBFD Bid facts concisely. You are advisory only. Never make an award, change policy, change an assignment, infer missing facts, or claim that an action was performed.',
      },
      {
        role: 'user',
        content: JSON.stringify({ kind: request.kind, facts: deidentify(request.facts) }),
      },
    ],
  });
  if (
    typeof result !== 'object' ||
    result === null ||
    !('response' in result) ||
    typeof result.response !== 'string' ||
    result.response.trim().length === 0
  ) {
    throw new Error('provider returned no explanation');
  }
  return result.response.trim().slice(0, 4_000);
}

function countWord(value: number): string {
  const words = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
  ];
  return words[value] ?? String(value);
}

function explain(request: ExplainRequest): string {
  switch (request.kind) {
    case 'eligibility': {
      const {
        determination,
        policy_reference: policyReference,
        reason_codes: reasonCodes,
        subject_reference: subject,
      } = request.facts;
      if (determination === 'eligible') {
        return `${subject} is eligible according to the supplied deterministic facts for ${policyReference}. This advisory does not choose a position or make an award.`;
      }
      const reasons =
        reasonCodes.length === 0 ? 'no reason code was supplied' : reasonCodes.join(', ');
      return `${subject} is ineligible according to the supplied deterministic facts for ${policyReference}: ${reasons}. This advisory cannot override eligibility.`;
    }
    case 'specialty_priority': {
      const {
        higher_priority_candidate_count: higherCount,
        policy_reference: policyReference,
        policy_state: policyState,
        requester_priority: requesterPriority,
        requester_reference: requester,
      } = request.facts;
      if (policyState === 'unresolved') {
        return `${requester} has specialty priority #${requesterPriority}, but ${policyReference} is unresolved. The specialty flow must remain blocked until an approved policy is configured; this advisory cannot select a winner.`;
      }
      if (higherCount === 0) {
        return `${requester} has specialty priority #${requesterPriority} under ${policyReference}, with no higher-priority eligible candidate(s) in the supplied facts. The deterministic Bid engine, not this advisory, decides whether the request can proceed.`;
      }
      return `${requester} has specialty priority #${requesterPriority} under ${policyReference}. There are ${countWord(higherCount)} higher-priority eligible candidate(s) in the supplied facts, so the normal turn should be suspended for the deterministic specialty adjudication flow. This advisory does not make an award.`;
    }
    case 'available_options': {
      const {
        available_option_count: optionCount,
        blocked_reason_codes: blockedReasons,
        policy_reference: policyReference,
        subject_reference: subject,
      } = request.facts;
      const blockers =
        blockedReasons.length === 0
          ? 'No blockers were supplied.'
          : `Blockers: ${blockedReasons.join(', ')}.`;
      return `${subject} has ${optionCount} available option(s) in the supplied facts for ${policyReference}. ${blockers} The deterministic engine remains authoritative.`;
    }
    case 'a_day': {
      const {
        available_option_count: optionCount,
        capacity_state: capacityState,
        policy_reference: policyReference,
        subject_reference: subject,
      } = request.facts;
      return `${subject} has ${optionCount} available A-Day option(s) under ${policyReference}; reported capacity is ${capacityState}. This is an explanation of supplied facts, not an A-Day allocation.`;
    }
    case 'teleStaff_conflict': {
      const {
        current_record_newer: currentRecordNewer,
        resolution_state: resolutionState,
        source_snapshot_as_of: sourceSnapshotAsOf,
      } = request.facts;
      return currentRecordNewer
        ? `The TeleStaff observation is dated ${sourceSnapshotAsOf} and a newer protected canonical record exists. Resolution is ${resolutionState}; the import must not silently overwrite the canonical record.`
        : `The TeleStaff observation is dated ${sourceSnapshotAsOf}. Resolution is ${resolutionState}; the deterministic reconciliation workflow must record a reviewed outcome before applying it.`;
    }
    case 'mock_summary': {
      const {
        bid_state: bidState,
        configuration_revision: configurationRevision,
        policy_reference: policyReference,
        session_reference: sessionReference,
      } = request.facts;
      return `Mock ${sessionReference} is in ${bidState} using configuration revision ${configurationRevision} and ${policyReference}. This advisory describes the immutable mock context only and cannot publish, assign, or write to the portal.`;
    }
  }
}

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.get('/status', (c) => c.json(providerStatus(c.env)));

router.post('/explain', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = ExplainSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

  const status = providerStatus(c.env);
  if (status.providerAvailable) {
    try {
      return c.json({
        ...status,
        determinationSource: 'supplied_deterministic_facts',
        explanation: await providerExplanation(c.env, parsed.data),
      });
    } catch {
      return c.json({
        ...status,
        mode: 'deterministic_fallback',
        providerAvailable: false,
        determinationSource: 'supplied_deterministic_facts',
        explanation: explain(parsed.data),
      });
    }
  }

  return c.json({
    ...status,
    determinationSource: 'supplied_deterministic_facts',
    explanation: explain(parsed.data),
  });
});

export default router;

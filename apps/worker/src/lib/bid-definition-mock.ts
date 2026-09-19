import { ulid } from 'ulid';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { getDb } from '../db/index.js';
import { loadConfigurationReceipt } from './admin-configuration-receipt.js';
import { assertBidDefinitionRunIntegrity } from './bid-definition-integrity.js';
import { prepareBidDefinitionRun } from './bid-definition-run.js';
import { loadFrozenSessionBidPolicy, summarizeBidSessionPolicySnapshot } from './bid-policy.js';
import { bidSessionCreationResponse, persistBidSessionCreation } from './bid-session-creation.js';

export const BidIdentitySchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim());
export const BidDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const BidMockSelectionSchema = z
  .object({ versionId: BidIdentitySchema, versionSha256: BidDigestSchema })
  .strict();
export const CreateBidMockSchema = BidMockSelectionSchema.extend({
  expectedContextSha256: BidDigestSchema,
  expectedSourceToken: BidDigestSchema,
}).strict();
const canonical = (value: unknown) => canonicalize(value as JsonValue);

export async function previewBidDefinitionMock(
  database: D1Database,
  year: number,
  input: z.infer<typeof BidMockSelectionSchema>,
) {
  const prepared = await prepareBidDefinitionRun(database, {
    year,
    ...input,
    bidSessionId: `preview-${ulid()}`,
    capturedAtMs: Date.now(),
    mode: 'mock',
  });
  if (!prepared.ok)
    return {
      wouldAllowCreateMock: false as const,
      policyError: prepared.code,
      ...('positionIds' in prepared ? { positionIds: prepared.positionIds } : {}),
      ...('tenureIssues' in prepared ? { tenureIssues: prepared.tenureIssues } : {}),
      ...('termIssues' in prepared ? { termIssues: prepared.termIssues } : {}),
    };
  return {
    wouldAllowCreateMock: true as const,
    versionId: input.versionId,
    versionSha256: input.versionSha256,
    versionNumber: prepared.snapshot.configurationRevision,
    contextSha256: prepared.pins.contextSha256,
    runtimeSourceToken: prepared.sourceGuard.token,
    pool: summarizeBidSessionPolicySnapshot(prepared.snapshot),
  };
}

function mockResponse(
  id: string,
  prepared: Extract<Awaited<ReturnType<typeof prepareBidDefinitionRun>>, { ok: true }>,
) {
  return {
    ...bidSessionCreationResponse(id, prepared.snapshot, true),
    bidDefinition: {
      versionId: prepared.pins.bidVersionId,
      versionNumber: prepared.snapshot.configurationRevision,
      versionSha256: prepared.pins.bidVersionSha256,
      snapshotSha256: prepared.pins.snapshotSha256,
      contextSha256: prepared.pins.contextSha256,
    },
  };
}

export async function createBidDefinitionMock(
  database: D1Database,
  input: {
    year: number;
    key: string;
    actorSubject: string;
    actorId: number | null;
    body: z.infer<typeof CreateBidMockSchema>;
  },
) {
  const receiptInput = {
    key: input.key,
    actorSubject: input.actorSubject,
    operation: 'bid-definition-mock-create',
    request: JSON.parse(
      canonical({ year: input.year, mode: 'mock', actorId: input.actorId, ...input.body }),
    ),
  };
  const replay = async () => {
    const prior = await loadConfigurationReceipt(database, receiptInput);
    if (!prior || !prior.ok) return prior;
    const id = BidIdentitySchema.safeParse(prior.response.id);
    if (!id.success)
      return { ok: false as const, error: 'session_policy_snapshot_integrity_invalid' };
    try {
      const session = await database
        .prepare('SELECT bid_year,is_mock FROM bid_sessions WHERE id=?')
        .bind(id.data)
        .first<{ bid_year: number; is_mock: number }>();
      const pins = await assertBidDefinitionRunIntegrity(database, id.data);
      const policy = await loadFrozenSessionBidPolicy(getDb(database), id.data);
      if (
        session?.bid_year !== input.year ||
        session.is_mock !== 1 ||
        !pins ||
        !policy.ok ||
        policy.snapshot.v !== 3 ||
        pins.bidVersionId !== input.body.versionId ||
        pins.bidVersionSha256 !== input.body.versionSha256 ||
        pins.contextSha256 !== input.body.expectedContextSha256
      )
        return { ok: false as const, error: 'session_policy_snapshot_integrity_invalid' };
      const expected = {
        ...bidSessionCreationResponse(id.data, policy.snapshot, true),
        bidDefinition: {
          versionId: pins.bidVersionId,
          versionNumber: policy.snapshot.configurationRevision,
          versionSha256: pins.bidVersionSha256,
          snapshotSha256: pins.snapshotSha256,
          contextSha256: pins.contextSha256,
        },
      };
      if (canonical(expected) !== canonical(prior.response))
        return { ok: false as const, error: 'session_policy_snapshot_integrity_invalid' };
      return { ok: true as const, replayed: true, response: expected };
    } catch {
      return { ok: false as const, error: 'session_policy_snapshot_integrity_invalid' };
    }
  };
  const prior = await replay();
  if (prior) return prior;
  const id = ulid();
  const capturedAtMs = Date.now();
  const prepared = await prepareBidDefinitionRun(database, {
    year: input.year,
    ...input.body,
    bidSessionId: id,
    capturedAtMs,
    mode: 'mock',
  });
  if (!prepared.ok)
    return {
      ok: false as const,
      error: 'session_policy_snapshot_unavailable',
      policyError: prepared.code,
      ...('positionIds' in prepared ? { positionIds: prepared.positionIds } : {}),
      ...('tenureIssues' in prepared ? { tenureIssues: prepared.tenureIssues } : {}),
      ...('termIssues' in prepared ? { termIssues: prepared.termIssues } : {}),
    };
  if (
    prepared.pins.contextSha256 !== input.body.expectedContextSha256 ||
    prepared.sourceGuard.token !== input.body.expectedSourceToken
  )
    return { ok: false as const, error: 'bid_run_context_changed' };
  const response = mockResponse(id, prepared);
  try {
    await persistBidSessionCreation(database, {
      id,
      year: input.year,
      capturedAtMs,
      isMock: true,
      snapshot: prepared.snapshot,
      snapshotJson: prepared.snapshotJson,
      pins: prepared.pins,
      guard: prepared.sourceGuard,
      actorId: input.actorId,
      receipt: receiptInput,
      response,
    });
    return { ok: true as const, replayed: false, response };
  } catch {
    return (await replay()) ?? { ok: false as const, error: 'bid_run_context_changed' };
  }
}

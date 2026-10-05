import {
  BidLaunchAcknowledgementSchema,
  BidLaunchReviewSchema,
  type BidSessionPolicySnapshot,
  isLiveBidActionAuthorized,
} from '@mbfd/shared';
import { ulid } from 'ulid';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { getDb } from '../db/index.js';
import type { WorkerEnv } from '../types/env.js';
import { loadConfigurationReceipt } from './admin-configuration-receipt.js';
import { assertBidDefinitionRunIntegrity } from './bid-definition-integrity.js';
import { bidSnapshotSha256 } from './bid-definition-pin.js';
import { prepareBidDefinitionRun } from './bid-definition-run.js';
import {
  bidLaunchContextForSnapshot,
  buildBidLaunchReview,
  checkBidLaunchAcknowledgement,
  loadStoredBidLaunchReview,
} from './bid-launch-review.js';
import {
  loadFrozenSessionBidPolicy,
  parseBidSessionPolicySnapshot,
  summarizeBidSessionPolicySnapshot,
} from './bid-policy.js';
import { bidSessionCreationResponse, persistBidSessionCreation } from './bid-session-creation.js';
import { evaluateLiveBidReadiness } from './live-bid-readiness.js';

export const BidLiveIdentitySchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim());
export const BidLiveDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const BidLiveSelectionSchema = z
  .object({ versionId: BidLiveIdentitySchema, versionSha256: BidLiveDigestSchema })
  .strict();
export const CreateBidLiveSchema = BidLiveSelectionSchema.extend({
  expectedContextSha256: BidLiveDigestSchema,
  expectedSourceToken: BidLiveDigestSchema,
  launchAcknowledgement: BidLaunchAcknowledgementSchema.optional(),
}).strict();

/** A Managed Live session is a separately consequential operation. In-session
 * and post-Bid transition approval must never confer this creation authority. */
export const LIVE_CREATION_ACTION = 'create_live_session' as const;
const canonical = (value: unknown) => canonicalize(value as JsonValue);

function hasLiveCreationAuthority(
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>,
  actorId: number | null,
): boolean {
  return (
    snapshot.settings.v === 3 &&
    isLiveBidActionAuthorized(snapshot.settings.livePolicy, LIVE_CREATION_ACTION, actorId)
  );
}

function liveResponse(
  id: string,
  prepared: Extract<Awaited<ReturnType<typeof prepareBidDefinitionRun>>, { ok: true }>,
) {
  return {
    ...bidSessionCreationResponse(id, prepared.snapshot, false),
    bidDefinition: {
      versionId: prepared.pins.bidVersionId,
      versionNumber: prepared.snapshot.configurationRevision,
      versionSha256: prepared.pins.bidVersionSha256,
      snapshotSha256: prepared.pins.snapshotSha256,
      contextSha256: prepared.pins.contextSha256,
    },
    ...(prepared.launchReview === undefined
      ? {}
      : {
          launchReview: prepared.launchReview,
          launchAcknowledged: prepared.launchReview.requiresAcknowledgement,
        }),
  };
}

/**
 * Read-only Live preflight for a saved definition. This deliberately shares
 * the prepared version/pin material with Mock creation; Live adds only frozen
 * action authority and readiness gates.
 */
export async function previewBidDefinitionLive(
  database: D1Database,
  env: WorkerEnv,
  year: number,
  input: z.infer<typeof BidLiveSelectionSchema>,
  actorId: number | null,
) {
  const prepared = await prepareBidDefinitionRun(database, {
    year,
    ...input,
    bidSessionId: `preview-live-${ulid()}`,
    capturedAtMs: Date.now(),
    mode: 'live',
    operatorControlledLaunch: true,
  });
  if (!prepared.ok)
    return {
      wouldAllowCreateLive: false as const,
      policyError: prepared.code,
      ...('positionIds' in prepared ? { positionIds: prepared.positionIds } : {}),
      ...('tenureIssues' in prepared ? { tenureIssues: prepared.tenureIssues } : {}),
      ...('termIssues' in prepared ? { termIssues: prepared.termIssues } : {}),
    };
  const launchContext = bidLaunchContextForSnapshot(prepared.snapshot, 'live');
  if (launchContext === null)
    return {
      wouldAllowCreateLive: false as const,
      policyError: 'session_launch_review_integrity_invalid',
    };
  const operatorAuthorized = hasLiveCreationAuthority(prepared.snapshot, actorId);
  const readiness = await evaluateLiveBidReadiness({
    db: getDb(database),
    env,
    bidSessionId: `preview-live-${ulid()}`,
    bidYear: year,
    frozenPolicy: { ok: true, snapshot: prepared.snapshot, coverage: prepared.coverage },
    operatorAuthorized,
    operatorControlledLaunch: true,
  });
  return {
    wouldAllowCreateLive: readiness.canStartLiveBid,
    versionId: input.versionId,
    versionSha256: input.versionSha256,
    versionNumber: prepared.snapshot.configurationRevision,
    contextSha256: prepared.pins.contextSha256,
    runtimeSourceToken: prepared.sourceGuard.token,
    pool: summarizeBidSessionPolicySnapshot(prepared.snapshot),
    readiness,
    launchReview: buildBidLaunchReview(launchContext, [
      ...(prepared.launchReview?.advisories ?? []),
      ...(readiness.launchAdvisories ?? []),
    ]),
  };
}

/**
 * Creates one non-Mock config session from the exact prepared version. All
 * readiness, source/context and conflict checks precede the single D1 batch;
 * the batch repeats the source/conflict condition so a race cannot materialize
 * an unreviewed real session.
 */
export async function createBidDefinitionLive(
  database: D1Database,
  env: WorkerEnv,
  input: {
    year: number;
    key: string;
    actorSubject: string;
    actorId: number | null;
    body: z.infer<typeof CreateBidLiveSchema>;
  },
) {
  const receiptInput = {
    key: input.key,
    actorSubject: input.actorSubject,
    operation: 'bid-definition-live-create',
    request: JSON.parse(
      canonical({ year: input.year, mode: 'live', actorId: input.actorId, ...input.body }),
    ),
  };
  const replay = async () => {
    const prior = await loadConfigurationReceipt(database, receiptInput);
    if (!prior || !prior.ok) return prior;
    const id = BidLiveIdentitySchema.safeParse(prior.response.id);
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
        session.is_mock !== 0 ||
        !pins ||
        !policy.ok ||
        policy.snapshot.v !== 3 ||
        policy.snapshot.settings.v !== 3 ||
        pins.bidVersionId !== input.body.versionId ||
        pins.bidVersionSha256 !== input.body.versionSha256 ||
        pins.contextSha256 !== input.body.expectedContextSha256
      )
        return { ok: false as const, error: 'session_policy_snapshot_integrity_invalid' };
      if (!hasLiveCreationAuthority(policy.snapshot, input.actorId)) {
        return {
          ok: false as const,
          error: 'live_action_forbidden' as const,
          action: LIVE_CREATION_ACTION,
        };
      }
      // Creation is replayed against its original sealed inputs. A later
      // pre-start scoring receipt changes the Start review, not this receipt.
      const originalRow = await database
        .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?')
        .bind(id.data)
        .first<{ snapshot_json: string }>();
      if (!originalRow || bidSnapshotSha256(originalRow.snapshot_json) !== pins.snapshotSha256)
        return { ok: false as const, error: 'session_policy_snapshot_integrity_invalid' };
      const { bidDefinition, ...originalMaterial } = JSON.parse(originalRow.snapshot_json);
      const originalSnapshot = parseBidSessionPolicySnapshot(JSON.stringify(originalMaterial));
      if (!originalSnapshot)
        return { ok: false as const, error: 'session_policy_snapshot_integrity_invalid' };
      const originalPinnedSnapshot = { ...originalSnapshot, bidDefinition };
      const launchContext = bidLaunchContextForSnapshot(originalPinnedSnapshot, 'live');
      if (launchContext === null)
        return { ok: false as const, error: 'session_policy_snapshot_integrity_invalid' };
      const originalReview =
        prior.response.launchReview === undefined
          ? null
          : BidLaunchReviewSchema.safeParse(prior.response.launchReview);
      if (
        originalReview !== null &&
        (!originalReview.success ||
          (input.body.launchAcknowledgement !== undefined &&
            input.body.launchAcknowledgement.advisorySha256 !== originalReview.data.advisorySha256))
      )
        return { ok: false as const, error: 'session_launch_review_integrity_invalid' };
      const launch = await loadStoredBidLaunchReview(
        database,
        id.data,
        launchContext,
        originalReview?.success ? originalReview.data.advisorySha256 : undefined,
      );
      if (originalReview !== null && launch === null)
        return { ok: false as const, error: 'session_launch_review_integrity_invalid' };
      if (launch !== null && !launch.ok) return launch;
      const expected = {
        ...bidSessionCreationResponse(id.data, policy.snapshot, false),
        bidDefinition: {
          versionId: pins.bidVersionId,
          versionNumber: policy.snapshot.configurationRevision,
          versionSha256: pins.bidVersionSha256,
          snapshotSha256: pins.snapshotSha256,
          contextSha256: pins.contextSha256,
        },
        ...(launch === null
          ? {}
          : { launchReview: launch.review, launchAcknowledged: launch.acknowledged }),
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
    mode: 'live',
    operatorControlledLaunch: true,
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
  if (!hasLiveCreationAuthority(prepared.snapshot, input.actorId)) {
    return {
      ok: false as const,
      error: 'live_action_forbidden' as const,
      action: LIVE_CREATION_ACTION,
    };
  }
  const readiness = await evaluateLiveBidReadiness({
    db: getDb(database),
    env,
    bidSessionId: id,
    bidYear: input.year,
    frozenPolicy: { ok: true, snapshot: prepared.snapshot, coverage: prepared.coverage },
    operatorAuthorized: true,
    operatorControlledLaunch: true,
  });
  if (!readiness.canStartLiveBid)
    return { ok: false as const, error: 'readiness_blocked', readiness };

  const launchContext = bidLaunchContextForSnapshot(prepared.snapshot, 'live');
  if (launchContext === null)
    return { ok: false as const, error: 'session_launch_review_integrity_invalid' };
  const launchReview = buildBidLaunchReview(launchContext, [
    ...(prepared.launchReview?.advisories ?? []),
    ...(readiness.launchAdvisories ?? []),
  ]);
  const acknowledgement = checkBidLaunchAcknowledgement(
    launchReview,
    input.body.launchAcknowledgement,
  );
  if (!acknowledgement.ok) return acknowledgement;

  const response = liveResponse(id, prepared);
  response.launchReview = launchReview;
  response.launchAcknowledged = acknowledgement.acknowledged;
  try {
    const creation = await persistBidSessionCreation(database, {
      id,
      year: input.year,
      capturedAtMs,
      isMock: false,
      snapshot: prepared.snapshot,
      snapshotJson: prepared.snapshotJson,
      pins: prepared.pins,
      guard: {
        sql: `(${prepared.sourceGuard.sql})
          AND NOT EXISTS(
            SELECT 1 FROM bid_sessions s
            WHERE s.bid_year=? AND s.is_mock=0 AND s.current_phase<>'complete'
          )`,
        parameters: [...prepared.sourceGuard.parameters, input.year],
      },
      actorId: input.actorId,
      receipt: receiptInput,
      response,
      operatorLaunchReview: {
        ...launchContext,
        review: launchReview,
        acknowledged: acknowledgement.acknowledged,
      },
    });
    if (creation[0]?.meta.changes !== 1 || creation[1]?.meta.changes !== 1)
      return { ok: false as const, error: 'bid_run_context_changed' };
    return { ok: true as const, replayed: false, response };
  } catch {
    return (await replay()) ?? { ok: false as const, error: 'bid_run_context_changed' };
  }
}

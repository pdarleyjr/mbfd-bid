import {
  type BidLaunchAcknowledgement,
  type BidLaunchAdvisory,
  type BidLaunchReview,
  BidLaunchReviewSchema,
  type BidSessionPolicySnapshot,
} from '@mbfd/shared';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { bidContentHash } from './bid-definition-content.js';
import { bidDefinitionContextHash } from './bid-definition-context.js';
import { BidDefinitionSnapshotPinSchema } from './bid-definition-pin.js';

export interface BidLaunchContext {
  mode: 'mock' | 'live';
  versionId: string;
  versionSha256: string;
  contextSha256: string;
}

export function bidLaunchContextForSnapshot(
  snapshot: BidSessionPolicySnapshot,
  mode: 'mock' | 'live',
): BidLaunchContext | null {
  if (snapshot.v !== 3) return null;
  if ('bidDefinition' in snapshot) {
    const pin = BidDefinitionSnapshotPinSchema.safeParse(snapshot.bidDefinition);
    if (!pin.success) return null;
    return {
      mode,
      versionId: pin.data.versionId,
      versionSha256: pin.data.versionSha256,
      contextSha256: snapshot.scoreReferenceSource
        ? bidContentHash(
            canonicalize({
              baseContextSha256: pin.data.contextSha256,
              scoringReceiptSha256: snapshot.scoreReferenceSource.receiptSha256,
            } as JsonValue),
          )
        : pin.data.contextSha256,
    };
  }
  const source = {
    ruleBookVersion: snapshot.ruleBookVersion,
    ruleBookRevision: snapshot.ruleBookRevision,
    configurationRevision: snapshot.configurationRevision,
    positionTemplateVersion: snapshot.positionTemplateVersion,
  };
  return {
    mode,
    versionId: `legacy:${snapshot.ruleBookVersion}:${snapshot.configurationRevision}`,
    versionSha256: bidContentHash(canonicalize(source as JsonValue)),
    contextSha256: bidDefinitionContextHash(snapshot),
  };
}

export function sourceQuestionLaunchAdvisory(count: number): BidLaunchAdvisory[] {
  return count === 0
    ? []
    : [
        {
          id: 'source_decisions',
          code: 'unresolved_source_decisions',
          affectedCount: count,
          detail: `${count} saved source questions remain unresolved. The saved configuration will govern this run; starting does not resolve those questions.`,
        },
      ];
}

export function credentialHoldLaunchAdvisory(count: number): BidLaunchAdvisory[] {
  return count === 0
    ? []
    : [
        {
          id: 'qualification_holds',
          code: 'credential_import_dispute_requires_review',
          affectedCount: count,
          detail: `${count} credential assertions require review. Held credentials remain unavailable for eligibility and points; starting does not approve them.`,
        },
      ];
}

export function buildBidLaunchReview(
  context: BidLaunchContext,
  advisories: readonly BidLaunchAdvisory[],
): BidLaunchReview {
  const canonicalAdvisory = (advisory: BidLaunchAdvisory) => canonicalize(advisory as JsonValue);
  const unique = [
    ...new Map(advisories.map((advisory) => [canonicalAdvisory(advisory), advisory])).values(),
  ];
  const normalized = unique
    .map((advisory) =>
      unique.filter((entry) => entry.id === advisory.id).length > 1
        ? {
            ...advisory,
            id: `${advisory.id}:${bidContentHash(canonicalAdvisory(advisory)).slice(0, 12)}`,
          }
        : advisory,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  return BidLaunchReviewSchema.parse({
    advisorySha256: bidContentHash(
      canonicalize({ ...context, advisories: normalized } as JsonValue),
    ),
    requiresAcknowledgement: normalized.length > 0,
    advisories: normalized,
  });
}

export function checkBidLaunchAcknowledgement(
  review: BidLaunchReview,
  acknowledgement: BidLaunchAcknowledgement | undefined,
  previouslyAcknowledged = false,
) {
  if (acknowledgement !== undefined && acknowledgement.advisorySha256 !== review.advisorySha256)
    return { ok: false as const, error: 'launch_review_changed' as const, launchReview: review };
  if (review.requiresAcknowledgement && !previouslyAcknowledged && acknowledgement === undefined)
    return {
      ok: false as const,
      error: 'launch_acknowledgement_required' as const,
      launchReview: review,
    };
  return {
    ok: true as const,
    acknowledged: previouslyAcknowledged || acknowledgement !== undefined,
  };
}

const StoredLaunchReviewSchema = z
  .object({
    mode: z.enum(['mock', 'live']),
    versionId: z.string().min(1),
    versionSha256: z.string().regex(/^[0-9a-f]{64}$/),
    contextSha256: z.string().regex(/^[0-9a-f]{64}$/),
    review: BidLaunchReviewSchema,
    acknowledged: z.boolean(),
  })
  .strict();

/** The acknowledgement is recorded with the creation transaction. It does
 * not modify the sealed snapshot, source decisions, or qualification ledger. */
export async function loadStoredBidLaunchReview(
  database: D1Database,
  sessionId: string,
  context: BidLaunchContext,
  expectedReviewSha256?: string,
) {
  const row = await database
    .prepare(`SELECT after_state FROM audit_log
    WHERE bid_session_id=? AND action='session_start' AND actor_type='admin' AND actor_id IS NOT NULL
      AND json_extract(after_state,'$.operatorLaunchReview') IS NOT NULL
      AND (? IS NULL OR json_extract(after_state,'$.operatorLaunchReview.review.advisorySha256')=?)
    ORDER BY seq DESC LIMIT 1`)
    .bind(sessionId, expectedReviewSha256 ?? null, expectedReviewSha256 ?? null)
    .first<{ after_state: string }>();
  if (!row) return null;
  try {
    const stored = StoredLaunchReviewSchema.parse(JSON.parse(row.after_state).operatorLaunchReview);
    if (
      stored.mode !== context.mode ||
      stored.versionId !== context.versionId ||
      stored.versionSha256 !== context.versionSha256 ||
      stored.contextSha256 !== context.contextSha256
    )
      return { ok: false as const, error: 'session_launch_review_integrity_invalid' as const };
    const rebuilt = buildBidLaunchReview(context, stored.review.advisories);
    if (
      rebuilt.advisorySha256 !== stored.review.advisorySha256 ||
      rebuilt.requiresAcknowledgement !== stored.review.requiresAcknowledgement
    )
      return { ok: false as const, error: 'session_launch_review_integrity_invalid' as const };
    return { ok: true as const, review: rebuilt, acknowledged: stored.acknowledged };
  } catch {
    return { ok: false as const, error: 'session_launch_review_integrity_invalid' as const };
  }
}

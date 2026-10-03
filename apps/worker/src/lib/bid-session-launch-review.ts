import type { BidLaunchAdvisory, BidSessionPolicySnapshot } from '@mbfd/shared';
import { getDb } from '../db/index.js';
import { BidDefinitionSnapshotPinSchema } from './bid-definition-pin.js';
import { loadBidDefinitionVersion } from './bid-definition-version.js';
import { loadPinnedBidEvidenceFreeze } from './bid-evidence-reviewed-update-storage.js';
import {
  bidLaunchContextForSnapshot,
  buildBidLaunchReview,
  credentialHoldLaunchAdvisory,
  loadStoredBidLaunchReview,
  sourceQuestionLaunchAdvisory,
} from './bid-launch-review.js';
import type { BidEvaluationEvidence } from './bid-policy.js';
import { unresolvedQualificationHolds } from './qualification-review-hold.js';

/** Reuses captured launch review after reload. Older managed sessions can
 * review their own sealed evidence; mutable Department evidence is never
 * consulted to invent a new qualification or participation decision. */
export async function readBidSessionLaunchReview(
  database: D1Database,
  sessionId: string,
  snapshot: BidSessionPolicySnapshot,
  isMock: boolean,
  readinessAdvisories: readonly BidLaunchAdvisory[] = [],
) {
  const context = bidLaunchContextForSnapshot(snapshot, isMock ? 'mock' : 'live');
  if (context === null || snapshot.v !== 3) return null;
  const pin =
    'bidDefinition' in snapshot
      ? BidDefinitionSnapshotPinSchema.parse(snapshot.bidDefinition)
      : undefined;
  const stored = await loadStoredBidLaunchReview(database, sessionId, context);
  if (stored !== null && !stored.ok) return stored;
  let advisories = stored?.review.advisories;
  if (advisories === undefined && pin !== undefined) {
    const version = await loadBidDefinitionVersion(database, pin.bidYear, pin.versionId);
    if (!version.ok || version.sha256 !== pin.versionSha256)
      return { ok: false as const, error: 'session_launch_review_integrity_invalid' as const };
    advisories = sourceQuestionLaunchAdvisory(
      version.content.sourceDecisions.filter((decision) => decision.status === 'OPEN').length,
    );
    const freeze = snapshot.settings.v === 3 ? snapshot.settings.evidenceFreeze : undefined;
    if (freeze !== undefined) {
      const saved = await loadPinnedBidEvidenceFreeze(
        getDb(database),
        pin.bidYear,
        freeze.freezeId,
      );
      if (
        !saved ||
        saved.row.evaluation_sha256 !== freeze.evaluationSha256 ||
        saved.row.credential_sha256 !== freeze.credentialSnapshot.sha256
      )
        return { ok: false as const, error: 'session_launch_review_integrity_invalid' as const };
      const credentials = JSON.parse(saved.row.credential_source_json) as Pick<
        BidEvaluationEvidence,
        'qualificationHolds' | 'qualificationEventRows'
      >;
      const holds = unresolvedQualificationHolds(
        credentials.qualificationHolds ?? [],
        credentials.qualificationEventRows.map((event) => ({
          ...event,
          createdAt: new Date(event.createdAt).getTime(),
        })),
        snapshot.credentialEvaluationOn ?? '',
      );
      advisories = [...advisories, ...credentialHoldLaunchAdvisory(holds.length)];
    }
  }
  const review = buildBidLaunchReview(context, [...(advisories ?? []), ...readinessAdvisories]);
  return {
    ok: true as const,
    context,
    review,
    acknowledged:
      stored?.acknowledged === true && stored.review.advisorySha256 === review.advisorySha256,
  };
}

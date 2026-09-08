import { type BidSessionPolicySnapshot, BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import type { BidSessionState } from '../durable/bid-session-state.js';
import { mutateAnnualPlan, replayAnnualPlanMutation } from './annual-plan-mutation.js';
import { loadAnnualPlanReview } from './annual-plan-review.js';
import { changedAnnualDependencies } from './annual-review-dependencies.js';
import { auditInsertStatement } from './audit.js';
import { prepareBidSessionPolicySnapshot } from './bid-policy.js';

export type FreezeAnnualPlanInput = {
  year: number;
  key: string;
  actorSubject: string;
  actorId: number | null;
  body: {
    expected_rule_revision: number;
    expected_configuration_revision: number;
    expected_source_revision: number;
    mock_session_id: string;
    reason: string;
    accept_review: true;
  };
};

/** Completed Mock awards must still refer to its frozen members and topology. */
export function validRehearsalCompletion(
  state: BidSessionState,
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>,
  sequence: number,
) {
  if (
    state.lastSeq !== sequence ||
    state.currentPhase !== 'complete' ||
    !state.annual?.completion ||
    state.annual.unresolvedMemberIds.length ||
    !state.aDay
  )
    return false;
  const participants = new Set(
    snapshot.members.filter((m) => m.pool !== 'EXCLUDED').map((m) => m.memberId),
  );
  const positions = new Map(
    snapshot.ruleBookMaterial.positions
      .filter((p) => p.bidParticipation === 'BIDDABLE')
      .map((p) => [p.id, p]),
  );
  const awarded = new Map<number, string>();
  for (const [positionId, fill] of Object.entries(state.fills)) {
    const position = positions.get(positionId);
    if (!position || !participants.has(fill.memberId) || awarded.has(fill.memberId)) return false;
    awarded.set(fill.memberId, position.shift);
  }
  const aDays = new Set<number>();
  for (const pick of state.aDay.picks) {
    if (aDays.has(pick.memberId) || awarded.get(pick.memberId) !== pick.shift) return false;
    aDays.add(pick.memberId);
  }
  return aDays.size === awarded.size;
}
/** Atomic publication of the existing designated book and document. Any failed
 * condition rolls back both publications, the audit, and the retry receipt. */
export async function freezeAnnualPlan(database: D1Database, input: FreezeAnnualPlanInput) {
  const operation = 'freeze-reviewed-plan';
  const prior = await replayAnnualPlanMutation(database, {
    ...input,
    operation,
    request: input.body,
  });
  if (prior) return prior;
  const review = await loadAnnualPlanReview(database, input.year);
  if (!review.ok) return { ok: false as const, error: review.error };
  if (!review.ready)
    return { ok: false as const, error: 'annual_review_blocked', blockers: review.blockers };
  if (
    review.ruleRevision !== input.body.expected_rule_revision ||
    review.configurationRevision !== input.body.expected_configuration_revision ||
    review.sourceRevision !== input.body.expected_source_revision
  )
    return { ok: false as const, error: 'annual_plan_or_source_changed' };
  const mock = await database
    .prepare(`SELECT s.is_mock,s.bid_year,p.snapshot_json,state.current_seq,state.last_command_id,r.command_type,r.outcome,r.result_seq
    FROM bid_sessions s JOIN bid_session_policy_snapshots p ON p.bid_session_id=s.id JOIN canonical_bid_session_state state ON state.bid_session_id=s.id
    LEFT JOIN bid_command_receipts r ON r.command_id=state.last_command_id AND r.bid_session_id=s.id WHERE s.id=?`)
    .bind(input.body.mock_session_id)
    .first<{
      is_mock: number;
      bid_year: number;
      snapshot_json: string;
      current_seq: number;
      last_command_id: string | null;
      command_type: string | null;
      outcome: string | null;
      result_seq: number | null;
    }>();
  if (
    !mock ||
    mock.is_mock !== 1 ||
    mock.bid_year !== input.year ||
    mock.command_type !== 'live.complete_session' ||
    mock.outcome !== 'accepted' ||
    mock.result_seq !== mock.current_seq
  )
    return { ok: false as const, error: 'completed_mock_receipt_required' };
  const canonical = await loadCanonicalBidSessionState(database, input.body.mock_session_id);
  if (
    !canonical ||
    canonical.currentPhase !== 'complete' ||
    !canonical.annual?.completion ||
    canonical.annual.unresolvedMemberIds.length
  )
    return { ok: false as const, error: 'completed_mock_required' };
  let raw: unknown;
  try {
    raw = JSON.parse(mock.snapshot_json);
  } catch {
    return { ok: false as const, error: 'mock_snapshot_invalid' };
  }
  const frozen = BidSessionPolicySnapshotSchema.safeParse(raw);
  const prepared = await prepareBidSessionPolicySnapshot(
    getDb(database),
    input.year,
    Date.now(),
    'mock',
  );
  if (!frozen.success || frozen.data.v !== 3 || !prepared.ok)
    return { ok: false as const, error: 'mock_snapshot_invalid' };
  if (!validRehearsalCompletion(canonical, frozen.data, mock.current_seq))
    return { ok: false as const, error: 'mock_completion_material_invalid' };
  const changed = changedAnnualDependencies(frozen.data, prepared.snapshot);
  if (changed.length)
    return {
      ok: false as const,
      error: 'mock_configuration_or_evidence_changed',
      changedDependencies: changed,
    };
  const documentId = prepared.snapshot.annualPolicyEvidence?.documentId;
  if (!documentId) return { ok: false as const, error: 'annual_policy_document_required' };
  const now = Date.now();
  const statements = [
    database
      .prepare(`INSERT INTO annual_freeze_reviews (id,bid_year,mock_session_id,mock_completion_seq,rule_revision,configuration_revision,source_revision,actor_subject,review_reason,created_at)
      SELECT ?,?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM canonical_bid_session_state WHERE bid_session_id=? AND current_seq=? AND last_command_id=?)
        AND EXISTS(SELECT 1 FROM annual_bid_policy_documents WHERE id=? AND rule_book_version=? AND status IN ('DRAFT','PUBLISHED'))
        AND EXISTS(SELECT 1 FROM bid_year_staffing_baselines WHERE bid_year=? AND status='accepted') THEN ? ELSE NULL END,?,?`)
      .bind(
        input.key,
        input.year,
        input.body.mock_session_id,
        mock.current_seq,
        review.ruleRevision,
        review.configurationRevision,
        review.sourceRevision,
        input.body.mock_session_id,
        mock.current_seq,
        mock.last_command_id,
        documentId,
        review.ruleBookVersion,
        input.year,
        input.actorSubject,
        input.body.reason,
        now,
      ),
    database
      .prepare(
        'UPDATE annual_plan_reviews SET reviewed_rule_revision=?,reviewed_configuration_revision=?,reviewed_source_revision=? WHERE bid_year=?',
      )
      .bind(review.ruleRevision, review.configurationRevision, review.sourceRevision, input.year),
    database
      .prepare(
        "UPDATE rule_books SET status='archived' WHERE effective_year=? AND status='active' AND version<>?",
      )
      .bind(input.year, review.ruleBookVersion),
    database
      .prepare(
        "UPDATE rule_books SET status='active',published_at=?,published_by=? WHERE version=? AND status='draft' AND revision=?",
      )
      .bind(now, input.actorId, review.ruleBookVersion, review.ruleRevision),
    database
      .prepare(
        "UPDATE annual_bid_policy_documents SET status='SUPERSEDED',updated_at=? WHERE rule_book_version=? AND status='PUBLISHED' AND id<>?",
      )
      .bind(now, review.ruleBookVersion, documentId),
    database
      .prepare(
        "UPDATE annual_bid_policy_documents SET status='PUBLISHED',published_at=COALESCE(published_at,?),published_by=COALESCE(published_by,?),updated_at=? WHERE id=? AND status IN ('DRAFT','PUBLISHED')",
      )
      .bind(now, input.actorId, now, documentId),
    auditInsertStatement(database, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: input.actorId,
      action: 'rule_book_clone',
      targetKind: 'rule_book',
      targetId: review.ruleBookVersion,
      reason: input.body.reason,
      afterState: { status: 'active', annual_freeze_key: input.key },
    }),
    auditInsertStatement(database, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: input.actorId,
      action: 'annual_policy_published',
      targetKind: 'annual_policy_document',
      targetId: documentId,
      reason: input.body.reason,
      afterState: { status: 'PUBLISHED', annual_freeze_key: input.key },
    }),
  ];
  return mutateAnnualPlan(database, {
    ...input,
    operation,
    request: input.body,
    response: {
      year: input.year,
      lifecycle: 'FROZEN',
      ruleBookVersion: review.ruleBookVersion,
      annualPolicyDocumentId: documentId,
      mockSessionId: input.body.mock_session_id,
      reviewedSourceRevision: review.sourceRevision,
    },
    reason: input.body.reason,
    statements,
  });
}

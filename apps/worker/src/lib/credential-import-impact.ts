import { getDb } from '../db/index.js';
import { type ImpactChange, annualEligibilityImpact } from './annual-eligibility-impact.js';
import { canonicalBidDefinition } from './bid-definition-content.js';
import { loadCurrentBidDefinition } from './bid-definition-facade.js';
import { prepareDefinition } from './bid-definition-impact.js';
import { captureBidDefinitionControl } from './bid-definition-source.js';
import { eligibilityMemberFromFrozen, loadBidEvaluationEvidence } from './bid-policy.js';

/** Compare the accepted credential ledger before this file arrived against
 * today's accepted ledger under the SAME current saved policy. No award or
 * readiness authority is granted by this read-only comparison. */
export async function credentialImportImpact(database: D1Database, importId: string, year: number) {
  const batch = await database
    .prepare('SELECT created_at FROM targetsolutions_imports WHERE id=?')
    .bind(importId)
    .first<{ created_at: number }>();
  if (!batch) return { error: 'import_not_found' };
  const guard = await captureBidDefinitionControl(database, year);
  const current = await loadCurrentBidDefinition(database, year);
  if (!guard || !current.ok) return { error: 'saved_bid_required' };
  const content = canonicalBidDefinition(current.response.content);
  if (!content.ok) return { error: 'rule_book_invalid' };
  const db = getDb(database);
  const evidence = await loadBidEvaluationEvidence(db, year);
  const beforeEvidence = {
    ...evidence,
    qualificationEventRows: evidence.qualificationEventRows.filter(
      (row) => row.createdAt.valueOf() < batch.created_at,
    ),
    qualificationHolds: evidence.qualificationHolds.filter(
      (row) => row.reviewedAt < batch.created_at,
    ),
    disputedRows: [],
  };
  const now = Date.now();
  const before = await prepareDefinition(
    db,
    content.content,
    content.coverage,
    beforeEvidence,
    now,
    'mock',
  );
  const after = await prepareDefinition(
    db,
    content.content,
    content.coverage,
    evidence,
    now,
    'mock',
  );
  if (!before.ok || !after.ok)
    return { error: !after.ok ? after.code : !before.ok ? before.code : 'evaluation_unavailable' };
  const cohort = (evaluation: typeof after.evaluation) =>
    evaluation.members
      .filter((m) => m.pool !== 'EXCLUDED')
      .map((m) => ({ memberId: m.memberId, evidence: eligibilityMemberFromFrozen(m) }));
  const lists: {
    positionId: string;
    positionLabel: string;
    gained: number[];
    lost: number[];
    orderingChanged: boolean;
  }[] = [];
  const changes: ImpactChange[] = [];
  annualEligibilityImpact(
    {
      beforeMembers: cohort(before.evaluation),
      afterMembers: cohort(after.evaluation),
      beforeRules: before.coverage.rules,
      afterRules: after.coverage.rules,
    },
    {
      change(cause, change) {
        if (cause === 'EVIDENCE') changes.push(change);
        return false;
      },
      position(positionId, left, right) {
        const gained = [...right]
          .filter(([id, row]) => row.eligible && !left.get(id)?.eligible)
          .map(([id]) => id);
        const lost = [...left]
          .filter(([id, row]) => row.eligible && !right.get(id)?.eligible)
          .map(([id]) => id);
        const orderingChanged = [...right].some(
          ([id, row]) =>
            row.eligible && left.get(id)?.eligible && row.priority !== left.get(id)?.priority,
        );
        if (gained.length || lost.length || orderingChanged) {
          const position = content.content.positions.find((p) => p.id === positionId);
          lists.push({
            positionId,
            positionLabel: position
              ? `${position.shift} shift · ${position.unit} · ${position.positionName}`
              : positionId,
            gained,
            lost,
            orderingChanged,
          });
        }
      },
    },
  );
  const fresh = await captureBidDefinitionControl(database, year);
  const freshCurrent = await loadCurrentBidDefinition(database, year);
  if (
    fresh?.token !== guard.token ||
    !freshCurrent.ok ||
    freshCurrent.response.version?.id !== current.response.version?.id
  )
    return { error: 'bid_definition_or_source_changed' };
  return {
    importId,
    version: current.response.version?.versionNumber ?? null,
    evaluationOn: after.evaluation.credentialEvaluationOn,
    positionCount: after.coverage.rules.length,
    affectedLists: lists,
    changes,
    members: after.evaluation.operatorIdentityProjection ?? [],
    notice:
      'Credential changes since this import arrived, evaluated under the current saved policy. Earlier Mocks retain their original evidence.',
  };
}

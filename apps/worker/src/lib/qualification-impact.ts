import { getDb } from '../db/index.js';
import { annualEligibilityImpact } from './annual-eligibility-impact.js';
import { eligibilityMemberFromFrozen, prepareBidSessionPolicySnapshot } from './bid-policy.js';
import {
  type LegacyCredentialBaseline,
  type QualificationLifecycleEvent,
  activeCredentialNamesByMemberAsOf,
  completedCredentialNamesAsOf,
} from './qualification-lifecycle.js';

/** Read-only what-if using the same dated qualification projection and rule evaluator as bidding. */
export async function previewQualificationImpact(
  database: D1Database,
  input: {
    expectedSourceRevision: number;
    memberId: number;
    legacyCredentials: LegacyCredentialBaseline[];
    events: QualificationLifecycleEvent[];
    proposed: QualificationLifecycleEvent;
  },
) {
  const source = await database
    .prepare('SELECT revision FROM annual_source_revision WHERE id=1')
    .first<{ revision: number }>();
  if (source?.revision !== input.expectedSourceRevision)
    return { ok: false as const, error: 'source_changed_retry_preview' };
  const years = await database
    .prepare(
      "SELECT year FROM bid_years WHERE status='configuring' AND rule_book_version IS NOT NULL ORDER BY year",
    )
    .all<{ year: number }>();
  const results = [];
  const events = [...input.events, input.proposed];
  for (const { year } of years.results) {
    if (input.proposed.specialtyCode !== null) {
      results.push({
        year,
        available: false,
        reason: 'specialty_procedure_changes_require_annual_review_and_practice',
      });
      continue;
    }
    const prepared = await prepareBidSessionPolicySnapshot(
      getDb(database),
      year,
      Date.now(),
      'mock',
    );
    if (!prepared.ok) {
      results.push({ year, available: false, reason: prepared.code });
      continue;
    }
    const member = prepared.snapshot.members.find((m) => m.memberId === input.memberId);
    if (!member || member.pool === 'EXCLUDED' || member.rank === 'CIVILIAN') {
      results.push({
        year,
        available: false,
        reason: member?.exclusionReason ?? 'member_not_in_participant_cohort',
      });
      continue;
    }
    const evaluationOn = member.scoringEvidence?.evaluationOn;
    if (!evaluationOn) {
      results.push({ year, available: false, reason: 'qualification_evaluation_date_required' });
      continue;
    }
    const updated = {
      ...member,
      credentialNames:
        activeCredentialNamesByMemberAsOf({
          asOf: evaluationOn,
          legacyCredentials: input.legacyCredentials,
          events,
        }).get(input.memberId) ?? [],
      scoringEvidence: {
        evaluationOn,
        completedCredentialNames: completedCredentialNamesAsOf({
          memberId: input.memberId,
          asOf: evaluationOn,
          legacyCredentials: input.legacyCredentials,
          events,
        }),
      },
    };
    const beforeMembers = prepared.snapshot.members
      .filter((m) => m.pool !== 'EXCLUDED' && m.rank !== 'CIVILIAN')
      .map((m) => ({ memberId: m.memberId, evidence: eligibilityMemberFromFrozen(m) }));
    const impact = annualEligibilityImpact({
      beforeMembers,
      afterMembers: beforeMembers.map((m) =>
        m.memberId === input.memberId
          ? { memberId: m.memberId, evidence: eligibilityMemberFromFrozen(updated) }
          : m,
      ),
      beforeRules: prepared.coverage.rules,
      afterRules: prepared.coverage.rules,
    });
    results.push({
      year,
      available: true,
      evaluationOn,
      changes: impact.evidence.changed.filter((c) => c.memberId === input.memberId),
      otherPriorityChanges: impact.evidence.changed.filter((c) => c.memberId !== input.memberId)
        .length,
    });
  }
  const after = await database
    .prepare('SELECT revision FROM annual_source_revision WHERE id=1')
    .first<{ revision: number }>();
  if (after?.revision !== source?.revision)
    return { ok: false as const, error: 'source_changed_retry_preview' };
  return {
    ok: true as const,
    sourceRevision: source?.revision,
    results,
    scope:
      'Eligibility, points and candidate priority at each configured qualification date. Specialty procedure, choices, capacity and actual awards still require annual review and practice. Saving current evidence does not change approved session snapshots or historical awards.',
  };
}

import {
  compareWithTrace,
  evaluateEligibility,
  evaluateEligibilityWithTrace,
} from '@mbfd/eligibility';
import {
  type BidDefinitionContent,
  type BidEvaluation,
  BidImpactResponseSchema,
} from '@mbfd/shared';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { getDb } from '../db/index.js';
import {
  type ImpactChange,
  type ImpactScore,
  annualEligibilityImpact,
  evaluateImpactCohort,
} from './annual-eligibility-impact.js';
import { rankFrozenSpecialtyCandidates } from './annual-specialty-policy.js';
import {
  bidContentHash,
  canonicalBidDefinition,
  definitionRuleBookMaterial,
} from './bid-definition-content.js';
import { bidDefinitionContextHash } from './bid-definition-context.js';
import { bidDefinitionDiff, loadCurrentBidDefinition } from './bid-definition-facade.js';
import { BidDigestSchema, BidIdentitySchema } from './bid-definition-mock.js';
import { captureBidDefinitionControl } from './bid-definition-source.js';
import { SaveBidDefinitionSchema } from './bid-definition-store.js';
import { loadBidDefinitionVersion } from './bid-definition-version.js';
import {
  type BidEvaluationEvidence,
  type BidEvaluationPreparation,
  type RuleBookCoverage,
  eligibilityMemberFromFrozen,
  loadBidEvaluationEvidence,
  prepareCapturedBidEvaluation,
  validateAnnualPolicySourceReferences,
} from './bid-policy.js';
import { computeBidEvaluationStageOrder } from './live-bid-policy.js';

const canonical = (value: unknown) => canonicalize(value as JsonValue);
const sortedIds = (ids: Iterable<number>) => [...new Set(ids)].sort((a, b) => a - b);
const PAGE_SIZE = 100;
export const BidImpactRequestSchema = z
  .object({
    kind: z.literal('impact'),
    expected: SaveBidDefinitionSchema.shape.expected,
    intent: SaveBidDefinitionSchema.shape.intent,
    mode: z.enum(['mock', 'live']),
    changeOffset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    expectedImpactSha256: BidDigestSchema.optional(),
    trace: z
      .object({
        memberId: z.number().int().positive(),
        positionId: BidIdentitySchema,
        compareMemberId: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type BidImpactRequest = z.infer<typeof BidImpactRequestSchema>;
type Ready = Extract<BidEvaluationPreparation, { ok: true }>;

/** Pure material has neither publication status nor document/version identity.
 * Live calculation changes participation semantics only; it grants no run authority. */
export async function prepareDefinition(
  db: ReturnType<typeof getDb>,
  content: BidDefinitionContent,
  coverage: RuleBookCoverage,
  evidence: BidEvaluationEvidence,
  capturedAtMs: number,
  mode: 'mock' | 'live',
): Promise<BidEvaluationPreparation> {
  if (content.settings === null) return { ok: false, code: 'bid_configuration_unconfigured' };
  if (content.settings.v === 1)
    return { ok: false, code: 'bid_configuration_credential_evaluation_date_required' };
  if (mode === 'live' && content.settings.v !== 3)
    return { ok: false, code: 'bid_configuration_live_policy_required' };
  const knownStaffing = new Set(evidence.staffingRows.map((row) => row.id));
  const missing = content.staffingBindings
    .filter((row) => !knownStaffing.has(row.staffingPositionId))
    .map((row) => row.positionId);
  if (missing.length)
    return { ok: false, code: 'non_biddable_staffing_position_not_approved', positionIds: missing };
  return prepareCapturedBidEvaluation(
    db,
    {
      bidYear: content.bidYear,
      settings: content.settings,
      coverage,
      bindings: content.staffingBindings,
      ruleBookMaterial: definitionRuleBookMaterial(content),
      sourceDecisions: content.sourceDecisions,
      // Include the actual proposed execution policy even before there is a
      // persisted source document. A new draft reference must see its disputes.
      policyReferenceJson: [
        ...content.rules.flatMap((rule) => [rule.requiredCriteriaJson, rule.pointsPreferenceJson]),
        ...(content.settings.v === 3 ? [JSON.stringify(content.settings.livePolicy)] : []),
      ],
    },
    evidence,
    capturedAtMs,
    mode,
  );
}

const cohort = (evaluation: BidEvaluation) =>
  evaluation.members
    .filter((member) => member.pool !== 'EXCLUDED')
    .map((member) => ({
      memberId: member.memberId,
      evidence: eligibilityMemberFromFrozen(member),
    }));

function stages(evaluation: BidEvaluation) {
  if (evaluation.settings.v !== 3)
    return { status: 'NOT_CONFIGURED' as const, codes: ['live_policy_missing'], entries: [] };
  const policy = evaluation.settings.livePolicy;
  const codes = validateAnnualPolicySourceReferences(evaluation, policy).filter(
    (code) => code.startsWith('stage_') || code === 'annual_stage_order_mismatch',
  );
  const order = computeBidEvaluationStageOrder(evaluation, policy);
  if (!order.ok) codes.push(order.code);
  return {
    status: codes.length ? ('BLOCKED' as const) : ('EVALUATED' as const),
    codes: [...new Set(codes)],
    entries: codes.length || !order.ok ? [] : order.entries.map((entry) => ({ ...entry })),
  };
}

function specialties(evaluation: BidEvaluation) {
  if (evaluation.settings.v !== 3) return [];
  const livePolicy = evaluation.settings.livePolicy;
  const annual = livePolicy.annualOperations;
  return (annual?.specialties ?? []).map((policy) => {
    const material = {
      id: policy.id,
      mode: policy.mode,
      opportunityPositionIds: policy.opportunityPositionIds,
    };
    const referenceErrors = validateAnnualPolicySourceReferences(evaluation, {
      ...livePolicy,
      ...(annual ? { annualOperations: { ...annual, specialties: [policy] } } : {}),
    }).filter((code) => code.startsWith('specialty_'));
    if (referenceErrors.length)
      return {
        ...material,
        status: 'BLOCKED' as const,
        code: referenceErrors[0] as string,
        candidates: [],
      };
    try {
      const candidates = rankFrozenSpecialtyCandidates({
        policy,
        evaluationOn: evaluation.credentialEvaluationOn as string,
        members: evaluation.members
          .filter((member) => member.pool !== 'EXCLUDED')
          .map((member) => ({
            ...member,
            specialtyQualifications: member.specialtyQualifications,
          })),
      });
      return {
        ...material,
        status: 'EVALUATED' as const,
        code: null,
        candidates: candidates.map((candidate, index) => ({ ...candidate, priority: index + 1 })),
      };
    } catch (error) {
      const code =
        error instanceof Error &&
        [
          'SPECIALTY_TIE_UNRESOLVED',
          'SPECIALTY_TIEBREAK_UNCONFIGURED',
          'SPECIALTY_SCORING_CONFIGURATION_INVALID',
        ].includes(error.message)
          ? error.message
          : 'specialty_evaluation_invalid';
      return { ...material, status: 'BLOCKED' as const, code, candidates: [] };
    }
  });
}

type OpportunityCount = {
  positionId: string;
  evaluatedMemberCount: number;
  eligibleMemberCount: number;
};
function countOpportunity(
  positionId: string,
  results: ReadonlyMap<number, ImpactScore>,
): OpportunityCount {
  let eligibleMemberCount = 0;
  for (const result of results.values()) if (result.eligible) eligibleMemberCount++;
  return { positionId, evaluatedMemberCount: results.size, eligibleMemberCount };
}

function projectSide(prepared: BidEvaluationPreparation, counts?: OpportunityCount[]) {
  if (!prepared.ok)
    return {
      status: 'BLOCKED' as const,
      code: prepared.code,
      positionIds: [...(prepared.positionIds ?? [])],
      tenureIssues: [...(prepared.tenureIssues ?? [])],
      ...(prepared.termIssues ? { termIssues: [...prepared.termIssues] } : {}),
    };
  const { evaluation } = prepared;
  const members = cohort(evaluation);
  const identity = new Map(
    evaluation.operatorIdentityProjection?.map((row) => [row.memberId, row]),
  );
  return {
    status: 'EVALUATED' as const,
    contextSha256: bidDefinitionContextHash(evaluation),
    personnelEvaluationOn:
      evaluation.settings.v !== 1 && evaluation.settings.personnelEvaluationOn
        ? evaluation.settings.personnelEvaluationOn
        : new Date(evaluation.capturedAtMs).toISOString().slice(0, 10),
    credentialEvaluationOn: evaluation.credentialEvaluationOn as string,
    members: evaluation.members.map((member) => {
      const person = identity.get(member.memberId);
      return {
        memberId: member.memberId,
        displayName: person ? `${person.firstName} ${person.lastName}`.trim() : null,
        rank: member.rank,
        pool: member.pool,
        exclusionReason: member.exclusionReason,
        authoritativeAssignmentId: member.authoritativeAssignmentId,
        mockParticipationEvidence: member.mockParticipationEvidence ?? null,
      };
    }),
    opportunities:
      counts ??
      prepared.coverage.rules.map((rule) =>
        countOpportunity(rule.positionId, evaluateImpactCohort(members, rule)),
      ),
    executionReferenceErrors:
      evaluation.settings.v === 3
        ? validateAnnualPolicySourceReferences(evaluation, evaluation.settings.livePolicy)
        : [],
    stageOrder: stages(evaluation),
    specialties: specialties(evaluation),
    selectionConsequences: {
      status: 'REQUIRES_SELECTION_CONTEXT' as const,
      areas: ['A_DAY_CAPACITY', 'NEXT_BIDDER', 'SPECIALTY_INTERRUPTION', 'POSITION_AWARDS'],
    },
  };
}

function traceSide(
  prepared: BidEvaluationPreparation,
  selection: NonNullable<BidImpactRequest['trace']>,
) {
  if (!prepared.ok) return { status: 'UNAVAILABLE' as const, code: prepared.code };
  const { evaluation, coverage } = prepared;
  const member = evaluation.members.find((row) => row.memberId === selection.memberId);
  if (!member) return { status: 'UNAVAILABLE' as const, code: 'member_not_in_evaluation' };
  const position = evaluation.ruleBookMaterial.positions.find(
    (row) => row.id === selection.positionId,
  );
  if (!position) return { status: 'UNAVAILABLE' as const, code: 'position_not_in_definition' };
  const pool = {
    pool: member.pool,
    exclusionReason: member.exclusionReason,
    authoritativeAssignmentId: member.authoritativeAssignmentId,
    mockParticipationEvidence: member.mockParticipationEvidence ?? null,
  };
  if (member.pool === 'EXCLUDED')
    return { status: 'NOT_APPLICABLE' as const, code: 'member_excluded_from_bid', pool };
  const rule = coverage.rules.find((row) => row.positionId === selection.positionId);
  if (!rule) return { status: 'NOT_APPLICABLE' as const, code: 'position_not_biddable', pool };
  const { result, channels } = evaluateEligibilityWithTrace(
    eligibilityMemberFromFrozen(member),
    rule,
  );
  const scores = evaluateImpactCohort(cohort(evaluation), rule);
  const score = scores.get(member.memberId);
  const livePolicy = evaluation.settings.v === 3 ? evaluation.settings.livePolicy : null;
  const memberStage = livePolicy?.stages.find((stage) => stage.memberIds.includes(member.memberId));
  const other =
    selection.compareMemberId === undefined
      ? undefined
      : evaluation.members.find((row) => row.memberId === selection.compareMemberId);
  let comparison = null;
  if (other && other.pool !== 'EXCLUDED' && result.eligible) {
    const otherResult = evaluateEligibility(eligibilityMemberFromFrozen(other), rule);
    if (otherResult.eligible)
      comparison = compareWithTrace(
        {
          ...result,
          rscSeniority: member.rscSeniority,
          rankSeniority: member.rankSeniority ?? Number.MAX_SAFE_INTEGER,
        },
        {
          ...otherResult,
          rscSeniority: other.rscSeniority,
          rankSeniority: other.rankSeniority ?? Number.MAX_SAFE_INTEGER,
        },
        rule.tieBreakChain,
      );
  }
  return {
    status: 'EVALUATED' as const,
    pool,
    eligible: result.eligible,
    reasons: result.reasons,
    points: result.points,
    soPoints: result.soPoints,
    moPoints: result.moPoints,
    breakdown: result.breakdown,
    channels,
    priority: score?.priority ?? null,
    tieBreakChain: rule.tieBreakChain,
    comparison,
    comparisonUnavailableReason:
      selection.compareMemberId === undefined
        ? null
        : !other
          ? 'comparison_member_not_in_evaluation'
          : other.pool === 'EXCLUDED'
            ? 'comparison_member_excluded'
            : comparison === null
              ? 'comparison_requires_two_eligible_members'
              : null,
    stage: memberStage
      ? {
          id: memberStage.id,
          opportunityAllowed: memberStage.opportunityPositionIds.includes(position.id),
        }
      : null,
    postAward: rule.requiredCriteria.postAward ?? [],
    evidence: {
      rank: member.rank,
      isProbationary: member.isProbationary,
      credentialNames: member.credentialNames,
      scoringEvidence: member.scoringEvidence ?? null,
      serviceCredits: member.serviceCredits ?? [],
    },
  };
}

function compareDefinitions(before: Ready, after: Ready, offset: number) {
  const beforeMembers = cohort(before.evaluation);
  const afterMembers = cohort(after.evaluation);
  const affected = new Set<number>();
  const changes: (ImpactChange & { cause: 'POLICY' | 'EVIDENCE' })[] = [];
  let policyChangeCount = 0;
  let evidenceChangeCount = 0;
  let changeCount = 0;
  const beforeCounts: OpportunityCount[] = [];
  const afterCounts: OpportunityCount[] = [];
  const impact = annualEligibilityImpact(
    {
      beforeMembers,
      afterMembers,
      beforeRules: before.coverage.rules,
      afterRules: after.coverage.rules,
    },
    {
      change: (cause, change) => {
        affected.add(change.memberId);
        if (cause === 'POLICY') policyChangeCount++;
        else evidenceChangeCount++;
        if (changeCount >= offset && changes.length < PAGE_SIZE) changes.push({ cause, ...change });
        changeCount++;
        return false;
      },
      position: (positionId, prior, next) => {
        beforeCounts.push(countOpportunity(positionId, prior));
        afterCounts.push(countOpportunity(positionId, next));
      },
    },
  );
  const left = new Map(before.evaluation.members.map((member) => [member.memberId, member]));
  const right = new Map(after.evaluation.members.map((member) => [member.memberId, member]));
  const pool = sortedIds([...left.keys(), ...right.keys()]).flatMap((memberId) => {
    const a = left.get(memberId);
    const b = right.get(memberId);
    const project = (member: typeof a) =>
      member
        ? {
            pool: member.pool,
            exclusionReason: member.exclusionReason,
            authoritativeAssignmentId: member.authoritativeAssignmentId,
            mockParticipationEvidence: member.mockParticipationEvidence ?? null,
          }
        : null;
    const beforePool = project(a);
    const afterPool = project(b);
    return canonical(beforePool) === canonical(afterPool)
      ? []
      : [{ memberId, before: beforePool, after: afterPool }];
  });
  for (const row of pool) affected.add(row.memberId);
  for (const memberId of [
    ...impact.incomparable.addedMemberIds,
    ...impact.incomparable.removedMemberIds,
  ])
    affected.add(memberId);
  // A new/removed opportunity is incomparable, never an invented zero-score side.
  for (const [prepared, members, positionIds, counts] of [
    [before, beforeMembers, impact.incomparable.removedPositionIds, beforeCounts],
    [after, afterMembers, impact.incomparable.addedPositionIds, afterCounts],
  ] as const) {
    for (const rule of prepared.coverage.rules.filter((row) =>
      positionIds.includes(row.positionId),
    )) {
      const results = evaluateImpactCohort(members, rule);
      counts.push(countOpportunity(rule.positionId, results));
      for (const [memberId, score] of results) if (score.eligible) affected.add(memberId);
    }
  }
  const beforeOrder = stages(before.evaluation);
  const afterOrder = stages(after.evaluation);
  const stageChanges =
    beforeOrder.status === 'EVALUATED' && afterOrder.status === 'EVALUATED'
      ? sortedIds(
          [...beforeOrder.entries, ...afterOrder.entries].map((row) => row.memberId),
        ).flatMap((memberId) => {
          const a = beforeOrder.entries.find((row) => row.memberId === memberId) ?? null;
          const b = afterOrder.entries.find((row) => row.memberId === memberId) ?? null;
          return canonical(a) === canonical(b) ? [] : [{ memberId, before: a, after: b }];
        })
      : null;
  for (const row of stageChanges ?? []) affected.add(row.memberId);
  const allowed = (evaluation: BidEvaluation, memberId: number) =>
    evaluation.settings.v === 3
      ? (evaluation.settings.livePolicy.stages.find((stage) => stage.memberIds.includes(memberId))
          ?.opportunityPositionIds ?? [])
      : [];
  const stageOpportunityChanges =
    before.evaluation.settings.v === 3 && after.evaluation.settings.v === 3
      ? sortedIds([...left.keys(), ...right.keys()]).flatMap((memberId) => {
          const a = new Set(allowed(before.evaluation, memberId));
          const b = new Set(allowed(after.evaluation, memberId));
          const addedPositionIds = [...b].filter((id) => !a.has(id)).sort();
          const removedPositionIds = [...a].filter((id) => !b.has(id)).sort();
          if (!addedPositionIds.length && !removedPositionIds.length) return [];
          affected.add(memberId);
          return [{ memberId, addedPositionIds, removedPositionIds }];
        })
      : null;
  const beforeSpecialties = specialties(before.evaluation);
  const afterSpecialties = specialties(after.evaluation);
  const specialtyChanges = [
    ...new Set([...beforeSpecialties, ...afterSpecialties].map((row) => row.id)),
  ]
    .sort()
    .map((id) => {
      const a = beforeSpecialties.find((row) => row.id === id);
      const b = afterSpecialties.find((row) => row.id === id);
      const addedPositionIds = (b?.opportunityPositionIds ?? []).filter(
        (id) => !a?.opportunityPositionIds.includes(id),
      );
      const removedPositionIds = (a?.opportunityPositionIds ?? []).filter(
        (id) => !b?.opportunityPositionIds.includes(id),
      );
      const modeChanged = a?.mode !== b?.mode;
      const applicability = { addedPositionIds, removedPositionIds, modeChanged };
      if (a?.status === 'BLOCKED' || b?.status === 'BLOCKED')
        return { id, ...applicability, status: 'UNAVAILABLE' as const, changes: [] };
      const changes = sortedIds(
        [...(a?.candidates ?? []), ...(b?.candidates ?? [])].map((row) => row.memberId),
      ).flatMap((memberId) => {
        const prior = a?.candidates.find((row) => row.memberId === memberId) ?? null;
        const next = b?.candidates.find((row) => row.memberId === memberId) ?? null;
        if (
          canonical(prior) === canonical(next) &&
          !modeChanged &&
          !addedPositionIds.length &&
          !removedPositionIds.length
        )
          return [];
        affected.add(memberId);
        return [{ memberId, before: prior, after: next }];
      });
      return { id, ...applicability, status: 'EVALUATED' as const, changes };
    });
  const unavailableAreas = [
    ...(stageChanges === null ? ['STAGE_ORDER'] : []),
    ...specialtyChanges
      .filter((row) => row.status === 'UNAVAILABLE')
      .map((row) => `SPECIALTY:${row.id}`),
  ];
  return {
    beforeCounts,
    afterCounts,
    comparison: {
      status: 'EVALUATED' as const,
      affectedMemberIds: sortedIds(affected),
      unavailableAreas,
      eligibility: {
        policyComparisonCount: impact.evaluatedComparisons,
        evidenceComparisonCount: impact.evidence.evaluatedComparisons,
        policyChangeCount,
        evidenceChangeCount,
        changeCount,
        changeOffset: offset,
        changes,
        nextChangeOffset: offset + PAGE_SIZE < changeCount ? offset + PAGE_SIZE : null,
        incomparable: impact.incomparable,
      },
      poolChanges: pool,
      stageChanges,
      stageOpportunityChanges,
      specialtyChanges,
    },
  };
}

/** The sole draft-impact entry point. It reads one raw Department capture and
 * evaluates both authored definitions against it. It writes no rows, receipts,
 * audit events, session state or version. A source/head race invalidates the whole result. */
export async function previewBidDefinitionImpact(
  database: D1Database,
  year: number,
  input: BidImpactRequest,
) {
  const control = await captureBidDefinitionControl(database, year);
  if (!control) return { ok: false as const, error: 'bid_definition_source_changed' };
  const current = await loadCurrentBidDefinition(database, year);
  if (!current.ok) return current;
  if (canonical(current.response.expected) !== canonical(input.expected))
    return { ok: false as const, error: 'bid_definition_or_source_changed' };
  const baseline = canonicalBidDefinition(current.response.content);
  if (!baseline.ok) return { ok: false as const, error: 'bid_definition_source_invalid' };
  const candidate =
    input.intent.operation === 'restore'
      ? await loadBidDefinitionVersion(database, year, input.intent.versionId)
      : canonicalBidDefinition(input.intent.content);
  if (!candidate.ok)
    return 'error' in candidate
      ? candidate
      : { ok: true as const, response: { valid: false as const, issues: candidate.issues } };
  if (candidate.content.bidYear !== year)
    return { ok: false as const, error: 'bid_definition_year_mismatch' };
  const capturedAtMs = Date.now();
  const db = getDb(database);
  const evidence = await loadBidEvaluationEvidence(db, year);
  const [before, after] = await Promise.all([
    prepareDefinition(db, baseline.content, baseline.coverage, evidence, capturedAtMs, input.mode),
    prepareDefinition(
      db,
      candidate.content,
      candidate.coverage,
      evidence,
      capturedAtMs,
      input.mode,
    ),
  ]);
  const compared =
    before.ok && after.ok ? compareDefinitions(before, after, input.changeOffset) : null;
  const comparison = compared?.comparison ?? {
    status: 'UNAVAILABLE' as const,
    code: 'both_definitions_must_be_evaluable',
  };
  const beforeProjection = projectSide(before, compared?.beforeCounts);
  const afterProjection = projectSide(after, compared?.afterCounts);
  const impactSha256 =
    before.ok && after.ok
      ? bidContentHash(
          canonical({
            v: 1,
            mode: input.mode,
            baselineContentSha256: baseline.sha256,
            candidateContentSha256: candidate.sha256,
            beforeContextSha256: bidDefinitionContextHash(before.evaluation),
            afterContextSha256: bidDefinitionContextHash(after.evaluation),
          }),
        )
      : null;
  const trace = input.trace
    ? {
        selection: input.trace,
        before: traceSide(before, input.trace),
        after: traceSide(after, input.trace),
      }
    : null;
  const refreshed = await loadCurrentBidDefinition(database, year);
  const afterControl = await captureBidDefinitionControl(database, year);
  if (
    !refreshed.ok ||
    canonical(refreshed.response.expected) !== canonical(input.expected) ||
    !afterControl ||
    afterControl.token !== control.token
  )
    return { ok: false as const, error: 'bid_definition_or_source_changed' };
  if (input.expectedImpactSha256 !== undefined && impactSha256 !== input.expectedImpactSha256)
    return { ok: false as const, error: 'bid_impact_context_changed' };
  return {
    ok: true as const,
    response: BidImpactResponseSchema.parse({
      valid: true as const,
      v: 1 as const,
      bidYear: year,
      source: {
        kind:
          input.intent.operation === 'restore'
            ? ('RESTORE_CANDIDATE' as const)
            : ('UNSAVED_DRAFT' as const),
        baselineContentSha256: baseline.sha256,
        candidateContentSha256: candidate.sha256,
      },
      mode: input.mode,
      capturedAtMs,
      runtimeSourceToken: control.token,
      impactSha256,
      before: beforeProjection,
      after: afterProjection,
      comparison,
      trace,
      diff: bidDefinitionDiff(baseline.content, candidate.content),
    }),
  };
}

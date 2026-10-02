import {
  type BidDefinitionContent,
  type BidEvaluation,
  BidEvaluationSchema,
  type FrozenLiveBidPolicy,
} from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import type { BidEvaluationEvidence } from './bid-policy.js';

const canonical = (value: unknown) => canonicalize(JSON.parse(JSON.stringify(value)) as JsonValue);
const invalid = () => ({
  ok: false as const,
  code: 'retained_participation_derivation_invalid' as const,
});
const RETENTION_FIELDS = [
  'pool',
  'exclusionReason',
  'authoritativeAssignmentId',
  'mockParticipationEvidence',
] as const;
type Member = BidEvaluation['members'][number];
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const effective = (asOf: string, from: string | null, through: string | null) =>
  (from === null || from <= asOf) && (through === null || through >= asOf);

function withoutMembers(evaluation: BidEvaluation) {
  const { members: _members, ...rest } = evaluation;
  return rest;
}

function immutableMemberFacts(member: Member) {
  const {
    pool: _pool,
    exclusionReason: _reason,
    authoritativeAssignmentId: _assignment,
    mockParticipationEvidence: _mock,
    credentialNames: _names,
    scoringEvidence,
    ...rest
  } = member;
  return {
    ...rest,
    ...(scoringEvidence === undefined
      ? {}
      : { scoringEvidence: { evaluationOn: scoringEvidence.evaluationOn } }),
  };
}

/** The caller supplies only integrity-checked, original frozen documents and
 * the canonical evaluator's output. Raw qualification capture historically
 * omitted review holds, so no qualification or scoring field is copied from
 * reevaluation. Source facts here limit the evaluator's participation changes
 * to approved incumbents of explicitly closed reserved annual roles. */
export function deriveFrozenReservedRetention(input: {
  original: BidEvaluation;
  recomputed: BidEvaluation;
  approvedContent: BidDefinitionContent;
  evidence: BidEvaluationEvidence;
}):
  | { ok: true; evaluation: BidEvaluation; retainedMemberIds: number[] }
  | { ok: false; code: 'retained_participation_derivation_invalid' } {
  const { original, recomputed, approvedContent, evidence } = input;
  if (!same(withoutMembers(original), withoutMembers(recomputed))) return invalid();
  if (original.members.length !== recomputed.members.length) return invalid();
  const nextById = new Map(recomputed.members.map((member) => [member.memberId, member]));
  if (nextById.size !== original.members.length) return invalid();
  const asOf =
    (original.settings.v === 1 ? undefined : original.settings.personnelEvaluationOn) ??
    new Date(original.capturedAtMs).toISOString().slice(0, 10);
  const terms =
    approvedContent.settings?.v === 3
      ? (approvedContent.settings.livePolicy.annualOperations?.assignmentTerms ?? [])
      : [];
  const evaluation = structuredClone(original);
  const retainedMemberIds: number[] = [];
  for (const [index, member] of evaluation.members.entries()) {
    const next = nextById.get(member.memberId);
    if (!next || !same(immutableMemberFacts(member), immutableMemberFacts(next))) return invalid();
    const changesRetention = RETENTION_FIELDS.some(
      (field) =>
        Object.hasOwn(member, field) !== Object.hasOwn(next, field) ||
        member[field] !== next[field],
    );
    if (!changesRetention) continue;
    if (
      member.pool === 'EXCLUDED' ||
      next.pool !== 'EXCLUDED' ||
      next.exclusionReason !== 'ADMIN_ASSIGNED_NON_BIDDABLE' ||
      next.authoritativeAssignmentId === null ||
      next.termParticipation !== undefined
    )
      return invalid();
    const assignments = evidence.assignmentRows.filter(
      (row) => row.id === next.authoritativeAssignmentId,
    );
    const assignment = assignments[0];
    if (
      assignments.length !== 1 ||
      !assignment ||
      assignment.memberId !== member.memberId ||
      assignment.status === 'cancelled' ||
      !(
        assignment.status === 'active' ||
        assignment.status === 'planned' ||
        ((assignment.status === 'ended' || assignment.status === 'superseded') &&
          assignment.effectiveTo !== null)
      ) ||
      !effective(asOf, assignment.effectiveFrom, assignment.effectiveTo)
    )
      return invalid();
    const bindings = approvedContent.staffingBindings.filter(
      (row) => row.staffingPositionId === assignment.staffingPositionId,
    );
    const binding = bindings[0];
    if (bindings.length !== 1 || !binding || binding.reviewStatus !== 'approved') return invalid();
    const participation = approvedContent.participation.filter(
      (row) => row.positionId === binding.positionId,
    );
    if (
      participation.length !== 1 ||
      participation[0]?.bidParticipation !== 'RESERVED_NON_BIDDABLE'
    )
      return invalid();
    const sealedPosition = original.ruleBookMaterial.positions.find(
      (row) => row.id === binding.positionId,
    );
    if (sealedPosition?.bidParticipation !== 'RESERVED_NON_BIDDABLE') return invalid();
    const closedTerms = terms.filter((term) => term.positionIds.includes(binding.positionId));
    if (closedTerms.length !== 1 || closedTerms[0]?.closedForThisBid !== true) return invalid();
    const staffing = evidence.staffingRows.filter(
      (row) => row.id === assignment.staffingPositionId,
    );
    if (
      staffing.length !== 1 ||
      staffing[0]?.reviewStatus !== 'approved' ||
      !effective(asOf, staffing[0].activeFrom, staffing[0].activeTo)
    )
      return invalid();
    const currentHolders = evidence.assignmentRows.filter(
      (row) =>
        row.staffingPositionId === assignment.staffingPositionId &&
        row.status !== 'cancelled' &&
        (row.status === 'active' ||
          row.status === 'planned' ||
          ((row.status === 'ended' || row.status === 'superseded') && row.effectiveTo !== null)) &&
        effective(asOf, row.effectiveFrom, row.effectiveTo),
    );
    if (currentHolders.length !== 1 || currentHolders[0]?.id !== assignment.id) return invalid();
    member.pool = next.pool;
    member.exclusionReason = next.exclusionReason;
    member.authoritativeAssignmentId = next.authoritativeAssignmentId;
    if (next.mockParticipationEvidence === undefined) {
      const { mockParticipationEvidence: _mock, ...withoutMock } = member;
      evaluation.members[index] = withoutMock;
    } else member.mockParticipationEvidence = next.mockParticipationEvidence;
    retainedMemberIds.push(member.memberId);
  }
  const checked = BidEvaluationSchema.safeParse(evaluation);
  if (!checked.success) return invalid();
  return {
    ok: true,
    evaluation: checked.data,
    retainedMemberIds: retainedMemberIds.sort((a, b) => a - b),
  };
}

function projectPolicy(policy: FrozenLiveBidPolicy, retained: ReadonlySet<number>) {
  for (const stage of policy.stages) {
    stage.memberIds = stage.memberIds.filter((id) => !retained.has(id));
    if (stage.participantProvenance) {
      stage.participantProvenance.resolvedMemberIds =
        stage.participantProvenance.resolvedMemberIds.filter((id) => !retained.has(id));
      if (stage.participantProvenance.participantSource.type === 'EXPLICIT_MEMBERS')
        stage.participantProvenance.participantSource.memberIds =
          stage.participantProvenance.participantSource.memberIds.filter((id) => !retained.has(id));
    }
  }
}

/** Mechanical projection only: preserve relative order, comparators, source
 * references, opportunity scope and every identity without proved retention.
 * This helper never resolves an authored rank into additional participants. */
export function projectRetainedParticipationContent(
  content: BidDefinitionContent,
  retainedMemberIds: readonly number[],
): BidDefinitionContent {
  const projected = structuredClone(content);
  const retained = new Set(retainedMemberIds);
  if (projected.settings?.v === 3) projectPolicy(projected.settings.livePolicy, retained);
  if (projected.policy) {
    projectPolicy(projected.policy.executionPolicy, retained);
    for (const source of projected.policy.stageParticipantSources ?? [])
      if (source.participantSource.type === 'EXPLICIT_MEMBERS')
        source.participantSource.memberIds = source.participantSource.memberIds.filter(
          (id) => !retained.has(id),
        );
  }
  return projected;
}

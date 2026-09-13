import { z } from 'zod';
import { CredentialEvaluationDateSchema, FrozenBidPoolMemberSchema } from './bid-policy.js';
import { PostAwardObligationSchema } from './post-award-obligation.js';
import { FrozenServiceCreditSchema } from './service-evidence.js';

const id = z.string().min(1);
const memberId = z.number().int().positive();
const count = z.number().int().nonnegative();
const number = z.number().finite();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const date = CredentialEvaluationDateSchema;
const ids = z.array(id);
const memberIds = z.array(memberId);
const statusCodes = z.array(z.string());
const Pool = FrozenBidPoolMemberSchema.pick({
  pool: true,
  exclusionReason: true,
  authoritativeAssignmentId: true,
})
  .extend({ mockParticipationEvidence: z.literal('ACCEPTED_STAFFING_BASELINE').nullable() })
  .strict();
const StageEntry = z.object({ ordinal: memberId, memberId, stageId: id }).strict();
const SpecialtyCandidate = z.object({ memberId, points: number, priority: memberId }).strict();
const Specialty = z
  .object({
    id,
    mode: z.enum(['INTERRUPTING', 'PRIORITY_ONLY']),
    opportunityPositionIds: ids,
    status: z.enum(['EVALUATED', 'BLOCKED']),
    code: z.string().nullable(),
    candidates: z.array(SpecialtyCandidate),
  })
  .strict();
const Side = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('BLOCKED'),
      code: z.string(),
      positionIds: ids,
      tenureIssues: z.array(
        z.object({ staffingPositionId: id, code: z.string(), recordId: id }).strict(),
      ),
    })
    .strict(),
  z
    .object({
      status: z.literal('EVALUATED'),
      contextSha256: digest,
      executionReferenceErrors: statusCodes,
      personnelEvaluationOn: date,
      credentialEvaluationOn: date,
      members: z.array(
        Pool.extend({
          memberId,
          displayName: z.string().nullable(),
          rank: z.enum(['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF', 'CIVILIAN']),
        }).strict(),
      ),
      opportunities: z.array(
        z
          .object({ positionId: id, evaluatedMemberCount: count, eligibleMemberCount: count })
          .strict(),
      ),
      stageOrder: z
        .object({
          status: z.enum(['NOT_CONFIGURED', 'BLOCKED', 'EVALUATED']),
          codes: statusCodes,
          entries: z.array(StageEntry),
        })
        .strict(),
      specialties: z.array(Specialty),
      selectionConsequences: z
        .object({
          status: z.literal('REQUIRES_SELECTION_CONTEXT'),
          areas: z.array(
            z.enum(['A_DAY_CAPACITY', 'NEXT_BIDDER', 'SPECIALTY_INTERRUPTION', 'POSITION_AWARDS']),
          ),
        })
        .strict(),
    })
    .strict(),
]);
const ImpactScore = z
  .object({
    eligible: z.boolean(),
    points: number,
    soPoints: number,
    moPoints: number,
    priority: memberId.nullable(),
    reasons: z.array(z.string()),
  })
  .strict();
const Comparison = z.discriminatedUnion('status', [
  z.object({ status: z.literal('UNAVAILABLE'), code: z.string() }).strict(),
  z
    .object({
      status: z.literal('EVALUATED'),
      affectedMemberIds: memberIds,
      unavailableAreas: statusCodes,
      eligibility: z
        .object({
          policyComparisonCount: count,
          evidenceComparisonCount: count,
          policyChangeCount: count,
          evidenceChangeCount: count,
          changeCount: count,
          changeOffset: count,
          changes: z
            .array(
              z
                .object({
                  cause: z.enum(['POLICY', 'EVIDENCE']),
                  positionId: id,
                  memberId,
                  before: ImpactScore,
                  after: ImpactScore,
                })
                .strict(),
            )
            .max(100),
          nextChangeOffset: count.nullable(),
          incomparable: z
            .object({
              addedMemberIds: memberIds,
              removedMemberIds: memberIds,
              addedPositionIds: ids,
              removedPositionIds: ids,
            })
            .strict(),
        })
        .strict(),
      poolChanges: z.array(
        z.object({ memberId, before: Pool.nullable(), after: Pool.nullable() }).strict(),
      ),
      stageChanges: z
        .array(
          z
            .object({ memberId, before: StageEntry.nullable(), after: StageEntry.nullable() })
            .strict(),
        )
        .nullable(),
      stageOpportunityChanges: z
        .array(z.object({ memberId, addedPositionIds: ids, removedPositionIds: ids }).strict())
        .nullable(),
      specialtyChanges: z.array(
        z
          .object({
            id,
            addedPositionIds: ids,
            removedPositionIds: ids,
            modeChanged: z.boolean(),
            status: z.enum(['UNAVAILABLE', 'EVALUATED']),
            changes: z.array(
              z
                .object({
                  memberId,
                  before: SpecialtyCandidate.nullable(),
                  after: SpecialtyCandidate.nullable(),
                })
                .strict(),
            ),
          })
          .strict(),
      ),
    })
    .strict(),
]);
const TieBreakKey = z.enum(['points', 'so_points', 'mo_points', 'rsc_seniority', 'rank_seniority']);
const Item = z
  .object({ credential: z.string(), awarded: number, reason: z.string().optional() })
  .strict();
const Channel = z.object({ total: number, itemized: z.array(Item) }).strict();
const TraceSide = z.discriminatedUnion('status', [
  z.object({ status: z.literal('UNAVAILABLE'), code: z.string() }).strict(),
  z.object({ status: z.literal('NOT_APPLICABLE'), code: z.string(), pool: Pool }).strict(),
  z
    .object({
      status: z.literal('EVALUATED'),
      pool: Pool,
      eligible: z.boolean(),
      reasons: z.array(
        z.object({ code: z.string(), label: z.string(), satisfied: z.boolean() }).strict(),
      ),
      points: number,
      soPoints: number,
      moPoints: number,
      breakdown: z
        .object({ total: number, soTotal: number, moTotal: number, itemized: z.array(Item) })
        .strict(),
      channels: z.object({ total: Channel, so: Channel, mo: Channel }).strict(),
      priority: memberId.nullable(),
      tieBreakChain: z.array(TieBreakKey),
      comparison: z
        .object({
          result: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
          steps: z.array(
            z
              .object({
                key: TieBreakKey,
                left: number,
                right: number,
                direction: z.enum(['HIGHER_FIRST', 'LOWER_FIRST']),
                result: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
              })
              .strict(),
          ),
        })
        .strict()
        .nullable(),
      comparisonUnavailableReason: z.string().nullable(),
      stage: z.object({ id, opportunityAllowed: z.boolean() }).strict().nullable(),
      postAward: z.array(PostAwardObligationSchema),
      evidence: z
        .object({
          rank: z.enum(['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF', 'CIVILIAN']),
          isProbationary: z.boolean(),
          credentialNames: z.array(z.string()),
          scoringEvidence: z
            .object({ evaluationOn: date, completedCredentialNames: z.array(z.string()) })
            .strict()
            .nullable(),
          serviceCredits: z.array(FrozenServiceCreditSchema),
        })
        .strict(),
    })
    .strict(),
]);
const KeyedDiff = z.object({ addedIds: ids, removedIds: ids, changedIds: ids }).strict();
export const BidImpactResponseSchema = z.discriminatedUnion('valid', [
  z
    .object({
      valid: z.literal(false),
      issues: z.array(
        z
          .object({
            path: z.array(z.union([z.string(), z.number()])),
            code: z.string(),
            message: z.string(),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      valid: z.literal(true),
      v: z.literal(1),
      bidYear: z.number().int(),
      source: z
        .object({
          kind: z.enum(['RESTORE_CANDIDATE', 'UNSAVED_DRAFT']),
          baselineContentSha256: digest,
          candidateContentSha256: digest,
        })
        .strict(),
      mode: z.enum(['mock', 'live']),
      capturedAtMs: count,
      runtimeSourceToken: digest,
      impactSha256: digest.nullable(),
      before: Side,
      after: Side,
      comparison: Comparison,
      trace: z
        .object({
          selection: z
            .object({ memberId, positionId: id, compareMemberId: memberId.optional() })
            .strict(),
          before: TraceSide,
          after: TraceSide,
        })
        .strict()
        .nullable(),
      diff: z
        .object({
          positions: KeyedDiff,
          rules: KeyedDiff,
          participation: KeyedDiff,
          staffingBindings: KeyedDiff,
          sourceDecisions: KeyedDiff,
          changedSections: ids,
        })
        .strict(),
    })
    .strict(),
]);
export type BidImpactResponse = z.infer<typeof BidImpactResponseSchema>;

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BidDefinitionContent } from '@mbfd/shared';
import { evaluate2026OpportunityInventory } from '../src/lib/2026-opportunity-inventory.js';
import { evaluate2026RankCapacity } from '../src/lib/2026-rank-capacity.js';
import { canonicalBidDefinition } from '../src/lib/bid-definition-content.js';
import {
  APPROVED_2026_ELIGIBILITY_CUTOFF_AT,
  buildCorrected2026Successor,
  list2026PositionReferences,
} from '../src/lib/corrected-2026-successor.js';

const [path, evaluationOn, approvedBidStartOn, identitiesPath] = process.argv.slice(2);
if (!path || !evaluationOn || !approvedBidStartOn || !identitiesPath)
  throw new Error(
    'Usage: tsx verify-corrected-2026-successor.ts <private-v8-content> <evaluation-on> <approved-bid-start-on> <private-member-identities>',
  );
const bytes = await readFile(path);
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
if (sourceSha256 !== '74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666')
  throw new Error('corrected_2026_successor_source_hash_mismatch');
const previous = JSON.parse(bytes.toString('utf8')) as BidDefinitionContent;
const memberIdentities = JSON.parse((await readFile(identitiesPath)).toString('utf8')) as {
  memberId: number;
  employeeId: string;
}[];
if (!Array.isArray(memberIdentities)) throw new Error('private_member_identity_projection_invalid');
const candidate = buildCorrected2026Successor(previous, {
  evaluationOn,
  approvedBidStartOn,
  memberIdentities,
});
const stages = candidate.policy?.executionPolicy.stages;
if (!stages) throw new Error('corrected_2026_stage_policy_missing');
const rankCapacity = evaluate2026RankCapacity(candidate, stages);
if (
  JSON.stringify(rankCapacity.capacity) !== JSON.stringify({ CPT: 23, LT: 39, FF: 161 }) ||
  JSON.stringify(rankCapacity.bidders) !== JSON.stringify({ CPT: 22, LT: 39, FF: 161 }) ||
  JSON.stringify(rankCapacity.expectedVacancies) !== JSON.stringify({ CPT: 1, LT: 0, FF: 0 }) ||
  rankCapacity.shortages.length > 0
)
  throw new Error('corrected_2026_final_rank_reconciliation_invalid');
const stageById = new Map(stages.map((stage) => [stage.id, stage]));
for (const [id, rank, stageId] of [
  ['B703', 'LT', 'lieutenants'],
  ['B704', 'FF', 'firefighters'],
  ['B705', 'FF', 'firefighters'],
  ['B706', 'FF', 'firefighters'],
]) {
  const position = candidate.positions.find((row) => row.id === id);
  const rule = candidate.rules.find((row) => row.positionId === id);
  if (
    position?.rankRequired !== rank ||
    !stageById.get(stageId)?.opportunityPositionIds.includes(id) ||
    !rule ||
    !JSON.parse(rule.requiredCriteriaJson).rank.includes(rank)
  )
    throw new Error(`corrected_2026_b_rescue_float_stage_rule_invalid:${id}`);
}
if (
  candidate.positions.some(
    (row) => row.id.startsWith('B70') && row.positionName === 'Firefighter #4',
  )
)
  throw new Error('corrected_2026_b_rescue_float_stale_fourth_firefighter');
const cutoffDecision = candidate.sourceDecisions.find(
  (decision) => decision.issueId === '2026-eligibility-cutoff-evidence',
);
if (
  evaluationOn !== '2026-09-30' ||
  approvedBidStartOn !== '2026-10-24' ||
  cutoffDecision?.status !== 'OPEN' ||
  cutoffDecision.blockingClassification !== 'BLOCKS_FINAL_EVIDENCE_CERTIFICATION' ||
  !cutoffDecision.decision.includes(APPROVED_2026_ELIGIBILITY_CUTOFF_AT)
)
  throw new Error('corrected_2026_cutoff_provenance_or_date_mismatch');
const canonical = canonicalBidDefinition(candidate);
const candidateIds = new Set(candidate.positions.map((position) => position.id));
const retiredIds = new Set(
  previous.positions.map((position) => position.id).filter((id) => !candidateIds.has(id)),
);
const retiredReferences = list2026PositionReferences(candidate).filter((id) => retiredIds.has(id));
const pools = candidate.policy?.executionPolicy.annualOperations?.opportunityPools ?? [];
const outOfPoolContext = pools.flatMap((pool) =>
  pool.positionIds.filter((id) => {
    const position = candidate.positions.find((item) => item.id === id);
    return !position || position.station === 'Station #2' || position.station === 'Station #6';
  }),
);
if (retiredReferences.length > 0 || outOfPoolContext.length > 0)
  throw new Error(
    `corrected_2026_successor_stale_policy_scope:retired=${retiredReferences.length}:special_float_pool=${outOfPoolContext.length}`,
  );
if (!canonical.ok) {
  process.stdout.write(
    JSON.stringify(
      {
        status: 'INVALID_LOCAL_CANDIDATE',
        issues: canonical.issues.map((issue) => ({ code: issue.code, path: issue.path })),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
  process.exitCode = 1;
} else {
  const byId = new Map(
    candidate.participation.map((row) => [row.positionId, row.bidParticipation]),
  );
  const inventory = evaluate2026OpportunityInventory(
    candidate.positions.map((position) => ({
      ...position,
      bidParticipation: byId.get(position.id) ?? 'BIDDABLE',
    })),
  );
  process.stdout.write(
    JSON.stringify(
      {
        status: 'LOCAL_DRY_RUN_ONLY',
        inputDatesAreOnlyDryRunParameters: { evaluationOn, approvedBidStartOn },
        sourceSha256,
        candidateSha256: canonical.sha256,
        positionCount: candidate.positions.length,
        ruleCount: candidate.rules.length,
        coverageValid: canonical.coverage.valid,
        inventory,
        rankCapacity,
        retiredPositionReferences: retiredReferences.length,
        specialOperationsOrMarineFloatPoolReferences: outOfPoolContext.length,
        sourceDecisions: {
          resolved: candidate.sourceDecisions.filter((item) => item.status === 'RESOLVED').length,
          openRealOnly: candidate.sourceDecisions.filter(
            (item) =>
              item.status === 'OPEN' &&
              item.blockingClassification === 'BLOCKS_REAL_BID_ACTIVATION',
          ).length,
          openFinalConfiguration: candidate.sourceDecisions.filter(
            (item) =>
              item.status === 'OPEN' &&
              item.blockingClassification === 'BLOCKS_FINAL_EVIDENCE_CERTIFICATION',
          ).length,
        },
        stages: candidate.policy?.executionPolicy.stages.map((stage) => ({
          id: stage.id,
          participants: stage.memberIds.length,
          opportunities: stage.opportunityPositionIds.length,
        })),
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
}

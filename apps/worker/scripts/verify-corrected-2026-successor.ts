import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BidDefinitionContent } from '@mbfd/shared';
import { evaluate2026OpportunityInventory } from '../src/lib/2026-opportunity-inventory.js';
import { canonicalBidDefinition } from '../src/lib/bid-definition-content.js';
import {
  APPROVED_2026_ELIGIBILITY_CUTOFF_AT,
  buildCorrected2026Successor,
} from '../src/lib/corrected-2026-successor.js';

const [path, evaluationOn, approvedBidStartOn] = process.argv.slice(2);
if (!path || !evaluationOn || !approvedBidStartOn)
  throw new Error(
    'Usage: tsx verify-corrected-2026-successor.ts <private-v8-content> <evaluation-on> <approved-bid-start-on>',
  );
const bytes = await readFile(path);
const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
if (sourceSha256 !== '74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666')
  throw new Error('corrected_2026_successor_source_hash_mismatch');
const previous = JSON.parse(bytes.toString('utf8')) as BidDefinitionContent;
const candidate = buildCorrected2026Successor(previous, { evaluationOn, approvedBidStartOn });
const cutoffDecision = candidate.sourceDecisions.find(
  (decision) => decision.issueId === '2026-eligibility-cutoff-evidence',
);
if (
  evaluationOn !== '2026-09-30' ||
  approvedBidStartOn !== '2026-10-24' ||
  cutoffDecision?.status !== 'OPEN' ||
  cutoffDecision.blockingClassification !== 'BLOCKS_FINAL_2026_CONFIGURATION' ||
  !cutoffDecision.decision.includes(APPROVED_2026_ELIGIBILITY_CUTOFF_AT)
)
  throw new Error('corrected_2026_cutoff_provenance_or_date_mismatch');
const canonical = canonicalBidDefinition(candidate);
const candidateIds = new Set(candidate.positions.map((position) => position.id));
const retiredIds = new Set(
  previous.positions.map((position) => position.id).filter((id) => !candidateIds.has(id)),
);
const retiredReferences: string[] = [];
function findRetiredReferences(value: unknown, pathSegments: (string | number)[] = []) {
  if (typeof value === 'string') {
    if (retiredIds.has(value)) retiredReferences.push(pathSegments.join('.'));
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      findRetiredReferences(item, [...pathSegments, index]);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value))
      findRetiredReferences(item, [...pathSegments, key]);
  }
}
findRetiredReferences(candidate);
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
              item.blockingClassification === 'BLOCKS_FINAL_2026_CONFIGURATION',
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

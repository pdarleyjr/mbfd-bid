import { type Member, type Rank, evaluateEligibilityCohort } from '@mbfd/eligibility';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { positionRules } from '../db/schema.js';
import type { EligibilityExportList } from '../exports/eligibility-lists.js';
import {
  loadBidEligibilityEvidence,
  projectAnnualMemberEvidence,
} from './bid-eligibility-evidence.js';
import { type BidOrdinalDatasetRow, projectBidOrdinals } from './bid-ordinal-evidence.js';
import { decodeRuleBookRows } from './position-rule.js';

const BID_RANKS = new Set<Rank>(['CHIEF', 'DEP_CHIEF', 'DC', 'CPT', 'LT', 'FF']);
function isBidRank(rank: string): rank is Rank {
  return BID_RANKS.has(rank as Rank);
}

export class EligibilityListLoadError extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? 'eligibility_list_failed'));
  }
}

/** Loads evidence once for one immutable list/export request. All position
 * evaluations then use the same roster, qualification projection, ordinals,
 * rule book, and as-of date. */
export async function loadAdminEligibilityListContext(input: {
  db: DB;
  ruleBookVersion: string;
  asOf: string;
  bidYear: number;
}) {
  const [ruleRows, evidence, ordinalRows] = await Promise.all([
    input.db
      .select()
      .from(positionRules)
      .where(eq(positionRules.ruleBookVersion, input.ruleBookVersion))
      .all(),
    loadBidEligibilityEvidence(input.db),
    input.db.all<BidOrdinalDatasetRow>(
      sql`SELECT id,bid_year AS bidYear,source_sha256 AS sourceSha256,source_ref AS sourceRef,entries_json AS entriesJson FROM bid_ordinal_datasets WHERE bid_year=${input.bidYear} ORDER BY revision DESC LIMIT 1`,
    ),
  ]);
  const decoded = decodeRuleBookRows(ruleRows);
  if (
    ruleRows.length === 0 ||
    decoded.invalidPositionIds.length > 0 ||
    decoded.duplicatePositionIds.length > 0
  )
    throw new EligibilityListLoadError(409, {
      error: 'rule_book_invalid',
      invalid_position_ids: decoded.invalidPositionIds,
      duplicate_position_ids: decoded.duplicatePositionIds,
    });
  const projected = projectAnnualMemberEvidence(evidence, input.asOf, input.asOf);
  if (!projected.ok) throw new EligibilityListLoadError(409, { error: projected.error });
  const ordinals = projectBidOrdinals(ordinalRows[0], evidence.memberRows);
  const personnelExclusions = projected.members
    .filter(
      (member) =>
        member.employmentStatus !== 'active' ||
        member.bidCategory === 'EXCLUDED' ||
        !isBidRank(member.rank),
    )
    .map((member) => ({
      member_id: member.memberId,
      employee_id: member.employeeId,
      first_name: member.firstName,
      last_name: member.lastName,
      status: 'EXCLUDED' as const,
      reasons: [
        ...(member.employmentStatus !== 'active'
          ? [`Employment status is ${member.employmentStatus}; active status is required`]
          : []),
        ...(member.bidCategory === 'EXCLUDED' ? ['Member is excluded from the Bid roster'] : []),
        ...(!isBidRank(member.rank) ? [`Classification ${member.rank} is not a Bid rank`] : []),
      ],
    }));
  const membersForEvaluation: Member[] = projected.members
    .filter(
      (member) =>
        member.employmentStatus === 'active' &&
        member.bidCategory !== 'EXCLUDED' &&
        isBidRank(member.rank),
    )
    .map((member) => {
      const activeCredentialNames = member.certifications.flatMap((credential) =>
        credential.name !== null &&
        credential.status === 'active' &&
        (credential.effectiveOn === null || credential.effectiveOn <= input.asOf) &&
        (credential.expiresOn === null || credential.expiresOn >= input.asOf)
          ? [credential.name]
          : [],
      );
      return {
        employeeId: member.employeeId,
        firstName: member.firstName,
        lastName: member.lastName,
        rank: member.rank as Rank,
        rscSeniority: member.rscSeniority,
        rankSeniority: member.rankSeniority ?? undefined,
        isProbationary: member.isProbationary,
        memberId: member.memberId,
        credentials: member.certifications.flatMap((credential) =>
          credential.name === null
            ? []
            : [
                {
                  name: credential.name,
                  status: credential.status,
                  effectiveOn: credential.effectiveOn,
                  expiresOn: credential.expiresOn,
                },
              ],
        ),
        scoringEvidence: {
          evaluationOn: input.asOf,
          completedCredentialNames: activeCredentialNames,
        },
        serviceCredits: member.serviceCredits,
        ...(ordinals.has(member.memberId)
          ? { bidOrdinalEvidence: ordinals.get(member.memberId) }
          : {}),
      };
    });
  const rulesByPosition = new Map(decoded.rules.map((rule) => [rule.positionId, rule]));

  return {
    positionIds: [...rulesByPosition.keys()].sort(),
    evaluate(positionId: string) {
      const rule = rulesByPosition.get(positionId);
      if (!rule)
        throw new EligibilityListLoadError(404, {
          error: 'rule_not_found',
          position_id: positionId,
          version: input.ruleBookVersion,
        });
      const result = evaluateEligibilityCohort({
        members: membersForEvaluation,
        rule,
        asOf: input.asOf,
      });
      return {
        ...result,
        metadata: {
          position_id: positionId,
          rule_book_version: input.ruleBookVersion,
          as_of: input.asOf,
          bid_year: input.bidYear,
          ordinal_dataset_id: ordinalRows[0]?.id ?? null,
          ordinal_source_sha256: ordinalRows[0]?.sourceSha256 ?? null,
          generated_at: new Date().toISOString(),
        },
        personnelExclusions,
      } satisfies EligibilityExportList & Record<string, unknown>;
    },
  };
}

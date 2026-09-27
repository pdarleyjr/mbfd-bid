import type { BidDefinitionContent } from '@mbfd/shared';
import { CredentialEvaluationDateSchema } from '@mbfd/shared';
import { evaluate2026OpportunityInventory } from './2026-opportunity-inventory.js';
import { buildCorrected2026DraftRules } from './corrected-2026-draft-rules.js';
import { buildCorrected2026SemanticRoles } from './corrected-2026-semantic-roles.js';
import {
  CORRECTED_2026_TOPOLOGY_SOURCE_DECISION,
  buildCorrected2026Topology,
} from './corrected-2026-topology.js';
import type { ReviewedPosition } from './reviewed-2026-source.js';

const policyCatalogBindings = new Map([
  ['credential-442af59635c2', 'PADI Public Safety Diver'],
  ['credential-5f8958dbc0ca', 'RN8977 Youth Fire Setter Prevention and Intervention course II'],
  ['credential-646879422773', 'RN8312 Assembly Occupancies'],
  ['credential-7a19bd0253d8', 'NFPA1126 Indoor Pyrotechnics'],
  ['credential-7e8c0bc46024', 'RN8977 Youth Fire Setter Prevention and Intervention course I'],
  ['credential-c85df9cf783c', 'DRI Public Safety Diver'],
  ['credential-f5597276eeae', 'NFPA1123 Outdoor Fireworks'],
]);

/** The MASTER Personnel row confirms a Captain Bid rank; the historical B211
 * staffing assignment does not turn this person into a biddable Chief seat. */
export const RETURNED_2026_CAPTAIN_MEMBER_ID = 9;

/** Direct administrator instruction. The date-only eligibility projection
 * cannot itself prove the 17:00 Eastern evidence boundary. */
export const APPROVED_2026_ELIGIBILITY_CUTOFF_AT = '2026-09-30T17:00:00-04:00';

const compareId = (a: string, b: string) => a.localeCompare(b);

function semanticKey(position: ReviewedPosition): string {
  // These are source-reviewed label corrections, not numeric ID substitutions.
  const unit =
    position.station === 'Station #3' && position.positionName.includes('INV')
      ? 'Combat 3'
      : position.unit;
  const division =
    position.station === 'Station #2' &&
    position.unit === 'Float 2' &&
    position.positionName === 'Firefighter #1 (C)' &&
    ['B', 'C'].includes(position.shift)
      ? 'Combat'
      : position.division;
  return [
    position.shift,
    position.station,
    division,
    unit,
    position.rankRequired,
    position.positionName,
    position.isFloating,
  ].join('|');
}

/** Match every prior position to a reviewed business role. The two pairs of
 * indistinguishable Marine Floats and closed Training seats retain sorted
 * source order within their exact semantic signature. */
export function map2026VersionPositionsByRole(
  previous: BidDefinitionContent['positions'],
): Map<string, string> {
  const corrected = buildCorrected2026Topology().filter(
    (position) => position.canonicalIdentity === undefined,
  );
  const groups = new Map<string, string[]>();
  for (const position of corrected) {
    const key = semanticKey(position);
    groups.set(key, [...(groups.get(key) ?? []), position.id].sort(compareId));
  }
  const previousGroups = new Map<string, string[]>();
  for (const position of previous) {
    const key = semanticKey(position);
    previousGroups.set(key, [...(previousGroups.get(key) ?? []), position.id].sort(compareId));
  }
  if (previous.length !== 228 || corrected.length !== 228)
    throw new Error('corrected_2026_source_position_count_mismatch');
  const mapped = new Map<string, string>();
  for (const [key, oldIds] of previousGroups) {
    const newIds = groups.get(key);
    if (!newIds || oldIds.length !== newIds.length)
      throw new Error(`corrected_2026_semantic_role_mismatch:${key}`);
    oldIds.forEach((id, index) => {
      const target = newIds[index];
      if (!target) throw new Error('corrected_2026_semantic_role_missing');
      mapped.set(id, target);
    });
  }
  if (mapped.size !== 228 || new Set(mapped.values()).size !== 228)
    throw new Error('corrected_2026_semantic_role_mapping_not_bijective');
  return mapped;
}

function remapReferences(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapReferences(item, ids));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapReferences(item, ids)]),
    );
  return value;
}

export interface Corrected2026SuccessorOptions {
  /** Explicit eligibility date, independent of the imported sheet revision. */
  evaluationOn: string;
  /** Required to freeze the conditional three-month Marine DRI term. */
  approvedBidStartOn: string;
}

/** Pure candidate construction. This does not save a version or start a Bid.
 * The prior version supplies reviewed policy structure and participant IDs;
 * every position-bearing scope is remapped by role before validation. */
export function buildCorrected2026Successor(
  previous: BidDefinitionContent,
  options: Corrected2026SuccessorOptions,
): BidDefinitionContent {
  if (previous.bidYear !== 2026 || previous.positions.length !== 228)
    throw new Error('corrected_2026_successor_requires_reviewed_prior_version');
  if (
    !CredentialEvaluationDateSchema.safeParse(options.evaluationOn).success ||
    !CredentialEvaluationDateSchema.safeParse(options.approvedBidStartOn).success
  )
    throw new Error('corrected_2026_successor_requires_explicit_valid_dates');
  if (options.evaluationOn !== '2026-09-30' || options.approvedBidStartOn !== '2026-10-24')
    throw new Error('corrected_2026_successor_dates_do_not_match_administrator_instruction');
  if (!previous.settings || previous.settings.v !== 3 || !previous.policy)
    throw new Error('corrected_2026_successor_requires_frozen_policy_and_settings');
  const oldToNew = map2026VersionPositionsByRole(previous.positions);
  const content = remapReferences(structuredClone(previous), oldToNew) as BidDefinitionContent;
  if (!content.settings || content.settings.v !== 3 || !content.policy)
    throw new Error('corrected_2026_successor_requires_frozen_policy_and_settings');
  const topology = buildCorrected2026Topology();
  const semantic = buildCorrected2026SemanticRoles();
  const draft = buildCorrected2026DraftRules({ approvedBidStartOn: options.approvedBidStartOn });
  if (draft.rules.length !== 223) throw new Error('corrected_2026_rule_count_mismatch');
  content.positions = topology.map((position) => ({
    id: position.id,
    shift: position.shift,
    station: position.station,
    division: position.division,
    unit: String(position.unit),
    rankRequired: position.rankRequired,
    positionName: position.positionName,
    isFloating: position.isFloating,
    isVacantByDesign: position.isVacantByDesign,
    isExcludedFromCount: position.isExcludedFromCount,
  }));
  content.participation = semantic.map((role) => ({
    positionId: role.positionId,
    bidParticipation:
      role.bidParticipation === 'BIDDABLE'
        ? 'BIDDABLE'
        : role.bidParticipation === 'CLOSED'
          ? 'RESERVED_NON_BIDDABLE'
          : 'ADMIN_ASSIGNED_NON_BIDDABLE',
    authoritativeSourceRef: role.policyRef,
  }));
  content.rules = draft.rules.map((rule) => ({
    positionId: rule.positionId,
    requiredCriteriaJson: JSON.stringify(rule.requiredCriteria),
    pointsPreferenceJson: JSON.stringify(rule.pointsPreference),
    tieBreakChainJson: JSON.stringify(rule.tieBreakChain),
    notes: `Final July 2026 Bid Policy; ${semantic.find((role) => role.positionId === rule.positionId)?.policyRef ?? 'reviewed semantic role'}`,
  }));
  content.authoring = null;
  content.settings.credentialEvaluationOn = options.evaluationOn;
  content.settings.personnelEvaluationOn = options.evaluationOn;
  const biddable = semantic.filter((role) => role.bidParticipation === 'BIDDABLE');
  const expectedByStage = new Map([
    [
      'days-captains',
      biddable
        .filter((role) => role.positionId.startsWith('D') && role.rank === 'CPT')
        .map((role) => role.positionId),
    ],
    [
      'days-lieutenants',
      biddable
        .filter((role) => role.positionId.startsWith('D') && role.rank === 'LT')
        .map((role) => role.positionId),
    ],
    [
      'captains',
      biddable
        .filter((role) => !role.positionId.startsWith('D') && role.rank === 'CPT')
        .map((role) => role.positionId),
    ],
    [
      'lieutenants',
      biddable
        .filter((role) => !role.positionId.startsWith('D') && role.rank === 'LT')
        .map((role) => role.positionId),
    ],
    [
      'firefighters',
      biddable
        .filter((role) => !role.positionId.startsWith('D') && role.rank === 'FF')
        .map((role) => role.positionId),
    ],
  ]);
  for (const policy of [content.policy.executionPolicy, content.settings.livePolicy]) {
    if (!policy) throw new Error('corrected_2026_successor_live_policy_missing');
    for (const stage of policy.stages) {
      const seats = expectedByStage.get(stage.id);
      if (!seats) throw new Error(`corrected_2026_unknown_stage:${stage.id}`);
      stage.opportunityPositionIds = seats.sort(compareId);
      if (stage.id === 'captains' || stage.id === 'days-captains')
        stage.memberIds = [...new Set([...stage.memberIds, RETURNED_2026_CAPTAIN_MEMBER_ID])].sort(
          (a, b) => a - b,
        );
    }
    if (!policy.annualOperations)
      throw new Error('corrected_2026_successor_annual_operations_missing');
    policy.annualOperations.requiredTopologyPositionIds = biddable
      .map((role) => role.positionId)
      .sort(compareId);
  }
  for (const source of content.policy.stageParticipantSources ?? []) {
    if (
      (source.stageId === 'captains' || source.stageId === 'days-captains') &&
      source.participantSource.type === 'EXPLICIT_MEMBERS'
    )
      source.participantSource.memberIds = [
        ...new Set([...source.participantSource.memberIds, RETURNED_2026_CAPTAIN_MEMBER_ID]),
      ].sort((a, b) => a - b);
  }
  if (
    content.sourceDecisions.some(
      (decision) => decision.issueId === CORRECTED_2026_TOPOLOGY_SOURCE_DECISION.issueId,
    )
  )
    throw new Error('corrected_2026_topology_source_decision_already_present');
  for (const decision of content.sourceDecisions) {
    const catalogName = policyCatalogBindings.get(decision.issueId);
    if (catalogName) {
      if (decision.status !== 'OPEN' || !decision.title.startsWith('Catalog binding:'))
        throw new Error(`corrected_2026_catalog_source_decision_changed:${decision.issueId}`);
      decision.status = 'RESOLVED';
      decision.decision = `The final July 2026 policy term binds to existing live catalog identity ${catalogName}. This does not establish any person's qualification, validity, or issuer evidence.`;
      decision.sourceRef =
        'Final July 2026 Bid Policy Procedures 3 and 8; live production credential catalog reviewed 2026-09-27; policy-2026-credentials.ts';
      decision.effectiveOn = '2026-09-27';
    }
    if (decision.issueId === 'investigator-tier') {
      if (decision.status !== 'OPEN')
        throw new Error('corrected_2026_investigator_source_decision_changed');
      decision.status = 'RESOLVED';
      decision.decision =
        'The final July policy Procedure 3(e) gives a Certified Fire Investigator the first ordered preference tier before secondary credits. The corrected 2026 Investigator rule implements this ordering; individual certificate evidence is evaluated separately.';
      decision.sourceRef =
        'Final July 2026 Bid Policy Procedure 3(e); corrected-2026-draft-rules.ts; corrected-2026-draft-rules.test.ts';
      decision.effectiveOn = '2026-09-27';
    }
  }
  content.sourceDecisions.push(CORRECTED_2026_TOPOLOGY_SOURCE_DECISION);
  content.sourceDecisions.push({
    issueId: '2026-eligibility-cutoff-evidence',
    title: 'September 30 at 17:00 eligibility evidence boundary',
    question:
      'Has the final credential and personnel evidence at the approved cutoff been reconciled?',
    area: 'annual-policy',
    status: 'OPEN',
    decision: `Administrator set ${APPROVED_2026_ELIGIBILITY_CUTOFF_AT} as the eligibility cutoff. The configured evaluation date is September 30, but date-only projection cannot establish the 17:00 evidence boundary. Reconcile the final source snapshot and same-day changes before saving the corrected version.`,
    sourceRef:
      'Administrator direct instruction 2026-09-27; final post-September 30 source reconciliation',
    effectiveOn: '2026-09-27',
    blockingClassification: 'BLOCKS_FINAL_2026_CONFIGURATION',
    affectedScopes: ['annual-policy'],
  });
  const participation = new Map(
    content.participation.map((row) => [row.positionId, row.bidParticipation]),
  );
  const inventory = evaluate2026OpportunityInventory(
    content.positions.map((position) => ({
      ...position,
      bidParticipation: participation.get(position.id) ?? 'BIDDABLE',
    })),
  );
  if (inventory.blockingCodes.length > 0 || inventory.total !== 223)
    throw new Error(
      `corrected_2026_successor_inventory_invalid:${inventory.blockingCodes.join(',')}`,
    );
  return content;
}

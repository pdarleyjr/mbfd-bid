import type { BidDefinitionContent, FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import { CredentialEvaluationDateSchema } from '@mbfd/shared';
import finalPositions from '../../seed/fixtures/final_2026_positions.json';
import { evaluate2026OpportunityInventory } from './2026-opportunity-inventory.js';
import { evaluate2026RankCapacity } from './2026-rank-capacity.js';
import { buildCorrected2026DraftRules } from './corrected-2026-draft-rules.js';
import { buildCorrected2026SemanticRoles } from './corrected-2026-semantic-roles.js';
import {
  CORRECTED_2026_B_RESCUE_FLOAT_SOURCE_DECISION,
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
export const RETURNED_2026_CAPTAIN_EMPLOYEE_ID = '18148';

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
): Map<string, string | null> {
  const corrected = buildCorrected2026Topology().filter(
    (position) => position.canonicalIdentity === undefined,
  );
  const bIds = new Set(['B701', 'B702', 'B703', 'B704', 'B705', 'B706']);
  const rawB = (finalPositions as ReviewedPosition[]).filter((position) => bIds.has(position.id));
  const oldB = previous.filter(
    (position) =>
      position.shift === 'B' &&
      position.station === 'Rescue Float Pool' &&
      position.division === 'Rescue' &&
      position.unit === 'Rescue Float' &&
      position.isFloating,
  );
  if (rawB.length !== 6 || oldB.length !== 6)
    throw new Error('corrected_2026_b_rescue_float_crosswalk_source_mismatch');
  const bMapping = new Map<string, string | null>();
  const targetByRaw = new Map<string, string | null>([
    ['B701', 'B701'],
    ['B702', 'B702'],
    ['B703', 'B704'],
    ['B704', 'B705'],
    ['B705', 'B706'],
    ['B706', null],
  ]);
  for (const raw of rawB) {
    const matches = oldB.filter((position) => semanticKey(position) === semanticKey(raw));
    if (matches.length !== 1 || !matches[0])
      throw new Error(`corrected_2026_b_rescue_float_crosswalk_role_mismatch:${raw.id}`);
    bMapping.set(matches[0].id, targetByRaw.get(raw.id) ?? null);
  }
  if (bMapping.size !== 6) throw new Error('corrected_2026_b_rescue_float_crosswalk_not_unique');
  const groups = new Map<string, string[]>();
  for (const position of corrected) {
    if (bIds.has(position.id)) continue;
    const key = semanticKey(position);
    groups.set(key, [...(groups.get(key) ?? []), position.id].sort(compareId));
  }
  const previousGroups = new Map<string, string[]>();
  for (const position of previous) {
    if (bMapping.has(position.id)) continue;
    const key = semanticKey(position);
    previousGroups.set(key, [...(previousGroups.get(key) ?? []), position.id].sort(compareId));
  }
  if (previous.length !== 228 || corrected.length !== 228)
    throw new Error('corrected_2026_source_position_count_mismatch');
  const mapped = new Map<string, string | null>(bMapping);
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
  if (mapped.size !== 228 || new Set([...mapped.values()].filter((id) => id !== null)).size !== 227)
    throw new Error('corrected_2026_semantic_role_mapping_not_bijective');
  return mapped;
}

/** Change only schema-declared position references. Prose, source citations,
 * member identities, and arbitrary strings remain byte-for-byte intact. */
export function remap2026PositionReferences(
  content: BidDefinitionContent,
  ids: ReadonlyMap<string, string | null>,
  observedReferences?: string[],
): BidDefinitionContent {
  const result = structuredClone(content);
  const map = (id: string) => {
    observedReferences?.push(id);
    return ids.has(id) ? (ids.get(id) ?? null) : id;
  };
  const mapAll = (values: string[]) => values.map(map).filter((id): id is string => id !== null);
  for (const policy of [
    result.policy?.executionPolicy,
    result.pendingPolicy?.executionPolicy,
    result.settings?.v === 3 ? result.settings.livePolicy : undefined,
  ]) {
    if (!policy) continue;
    for (const stage of policy.stages)
      stage.opportunityPositionIds = mapAll(stage.opportunityPositionIds);
    const operations = policy.annualOperations;
    if (!operations) continue;
    operations.requiredTopologyPositionIds = mapAll(operations.requiredTopologyPositionIds);
    for (const specialty of operations.specialties ?? [])
      specialty.opportunityPositionIds = mapAll(specialty.opportunityPositionIds);
    for (const pool of operations.opportunityPools ?? [])
      pool.positionIds = mapAll(pool.positionIds);
    for (const term of operations.assignmentTerms ?? [])
      term.positionIds = mapAll(term.positionIds);
    for (const fallback of operations.fallbackPolicies ?? [])
      fallback.positionIds = mapAll(fallback.positionIds);
    for (const exception of operations.aDay.execution?.timingExceptions ?? [])
      exception.positionIds = mapAll(exception.positionIds);
    for (const constraint of operations.aDay.execution?.constraints ?? [])
      constraint.positionIds = mapAll(constraint.positionIds);
  }
  for (const binding of result.staffingBindings) {
    const next = map(binding.positionId);
    if (next === null)
      throw new Error(`corrected_2026_retired_position_has_staffing_binding:${binding.positionId}`);
    binding.positionId = next;
  }
  return result;
}

export function list2026PositionReferences(content: BidDefinitionContent): string[] {
  const references: string[] = [];
  remap2026PositionReferences(content, new Map(), references);
  return references;
}

export interface Corrected2026SuccessorOptions {
  /** Explicit eligibility date, independent of the imported sheet revision. */
  evaluationOn: string;
  /** Required to freeze the conditional three-month Marine DRI term. */
  approvedBidStartOn: string;
  /** Immutable roster projection from the same reviewed candidate evidence. */
  memberIdentities: readonly { memberId: number; employeeId: string }[];
}

export interface ReviewedAdministrativeStaffingSlot {
  id: string;
  stableSlotKey: string;
  shift: string;
  station: string;
  unit: string;
  positionName: string;
  applicableRank: string;
  reviewStatus: string;
  activeFrom: string | null;
  activeTo: string | null;
}

/** The four administrative seats were absent from Version 8's bindings.
 * Require one already approved Department slot for each reviewed role before
 * proposing its audited saved-version connection. The B-shift command slot is
 * occupied by an acting Captain in the accepted operational source. */
export function withReviewed2026AdministrativeConnections(
  content: BidDefinitionContent,
  slots: readonly ReviewedAdministrativeStaffingSlot[],
): BidDefinitionContent {
  const required = [
    {
      positionId: 'A211',
      shift: 'A Shift',
      station: 'Division Chief',
      unit: 'Division Chief 300',
      positionName: 'Division Chief',
      applicableRank: 'DC',
    },
    {
      positionId: 'B211',
      shift: 'B Shift',
      station: 'Division Chief',
      unit: 'Division Chief 300',
      positionName: 'Division Chief',
      applicableRank: 'CPT',
    },
    {
      positionId: 'C211',
      shift: 'C Shift',
      station: 'Division Chief',
      unit: 'Division Chief 300',
      positionName: 'Division Chief',
      applicableRank: 'DC',
    },
    {
      positionId: 'A801',
      shift: 'A Shift',
      station: 'Fire Union',
      unit: 'Union Position',
      positionName: 'Union President',
      applicableRank: 'CPT',
    },
  ] as const;
  const next = structuredClone(content);
  for (const role of required) {
    if (next.staffingBindings.some((binding) => binding.positionId === role.positionId))
      throw new Error(`reviewed_2026_administrative_connection_already_present:${role.positionId}`);
    const matching = slots.filter(
      (slot) =>
        slot.shift === role.shift &&
        slot.station === role.station &&
        slot.unit === role.unit &&
        slot.positionName === role.positionName &&
        slot.applicableRank === role.applicableRank &&
        slot.reviewStatus === 'approved' &&
        slot.stableSlotKey.startsWith('TELSTAFF/v1/') &&
        (slot.activeFrom === null || slot.activeFrom <= '2026-09-30') &&
        (slot.activeTo === null || slot.activeTo >= '2026-09-30'),
    );
    if (matching.length !== 1 || !matching[0])
      throw new Error(`reviewed_2026_administrative_connection_not_unique:${role.positionId}`);
    next.staffingBindings.push({
      positionId: role.positionId,
      staffingPositionId: matching[0].id,
      authoritativeSourceRef: `Reviewed 2026 non-biddable Department connection; approved TeleStaff slot ${matching[0].stableSlotKey}`,
      reviewStatus: 'approved',
    });
  }
  next.staffingBindings.sort((left, right) => left.positionId.localeCompare(right.positionId));
  return next;
}

export function resolveReturned2026CaptainMemberId(
  identities: readonly { memberId: number; employeeId: string }[],
): number {
  const matches = identities.filter(
    (member) => member.employeeId === RETURNED_2026_CAPTAIN_EMPLOYEE_ID,
  );
  const match = matches[0];
  if (
    matches.length !== 1 ||
    !match ||
    !Number.isSafeInteger(match.memberId) ||
    match.memberId <= 0
  )
    throw new Error('returned_2026_captain_employee_identity_not_unique');
  return match.memberId;
}

export function addReviewedBRescueLieutenantPolicySeat(
  operations: FrozenAnnualOperationsPolicy,
): void {
  const pools = operations.opportunityPools?.filter((pool) => pool.id === 'rescue-float-B-lt');
  if (pools?.length !== 1 || pools[0]?.positionIds.join(',') !== 'B701,B702')
    throw new Error('corrected_2026_b_rescue_lieutenant_pool_unreviewed');
  pools[0].positionIds = ['B701', 'B702', 'B703'];
  const fallbacks = operations.fallbackPolicies?.filter(
    (item) => item.id === 'fallback-rescue-float',
  );
  if (
    fallbacks?.length !== 1 ||
    !fallbacks[0]?.positionIds.includes('B701') ||
    !fallbacks[0]?.positionIds.includes('B702') ||
    fallbacks[0]?.positionIds.includes('B703')
  )
    throw new Error('corrected_2026_b_rescue_lieutenant_fallback_unreviewed');
  fallbacks[0].positionIds = [...fallbacks[0].positionIds, 'B703'].sort(compareId);
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
  const returnedCaptainMemberId = resolveReturned2026CaptainMemberId(options.memberIdentities);
  const oldToNew = map2026VersionPositionsByRole(previous.positions);
  const content = remap2026PositionReferences(previous, oldToNew);
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
  content.settings.evidenceCutoffAt = APPROVED_2026_ELIGIBILITY_CUTOFF_AT;
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
        stage.memberIds = [...new Set([...stage.memberIds, returnedCaptainMemberId])].sort(
          (a, b) => a - b,
        );
    }
    if (!policy.annualOperations)
      throw new Error('corrected_2026_successor_annual_operations_missing');
    policy.annualOperations.requiredTopologyPositionIds = biddable
      .map((role) => role.positionId)
      .sort(compareId);
    addReviewedBRescueLieutenantPolicySeat(policy.annualOperations);
  }
  for (const source of content.policy.stageParticipantSources ?? []) {
    if (
      (source.stageId === 'captains' || source.stageId === 'days-captains') &&
      source.participantSource.type === 'EXPLICIT_MEMBERS'
    )
      source.participantSource.memberIds = [
        ...new Set([...source.participantSource.memberIds, returnedCaptainMemberId]),
      ].sort((a, b) => a - b);
  }
  const rankCapacity = evaluate2026RankCapacity(content, content.policy.executionPolicy.stages);
  if (rankCapacity.shortages.length > 0)
    throw new Error(
      `corrected_2026_rank_capacity_insufficient:${rankCapacity.shortages.map((item) => `${item.rank}:${item.bidders}>${item.capacity}`).join(',')}`,
    );
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
  if (
    content.sourceDecisions.some(
      (decision) => decision.issueId === CORRECTED_2026_B_RESCUE_FLOAT_SOURCE_DECISION.issueId,
    )
  )
    throw new Error('corrected_2026_b_rescue_float_source_decision_already_present');
  content.sourceDecisions.push(CORRECTED_2026_B_RESCUE_FLOAT_SOURCE_DECISION);
  content.sourceDecisions.push({
    issueId: '2026-b211-substantive-captain',
    title: 'B211 acting assignment and substantive Captain Bid participation',
    question:
      'Does the current B211 command assignment remove employee 18148 from the Captain Bid?',
    area: 'annual-policy',
    status: 'RESOLVED',
    decision:
      'Employee 18148 retains a substantive Captain Bid rank and participates in the 2026 Captain Bid. The current acting B211 command assignment remains protected and non-biddable; it is not an individual exclusion.',
    sourceRef:
      'Final MASTER Personnel row 19, Bid Pick row 4, and Tables exclusion list; administrator 2026-09-26 source reconciliation',
    effectiveOn: '2026-09-26',
  });
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
    blockingClassification: 'BLOCKS_FINAL_EVIDENCE_CERTIFICATION',
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

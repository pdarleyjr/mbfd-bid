import {
  type BidConfigurationSettings,
  BidConfigurationSettingsSchema,
  type BidParticipation,
  type BidSessionPolicySnapshot,
  BidSessionPolicySnapshotSchema,
  type FrozenBidEligibilityMember,
  type FrozenBidPoolMember,
} from '@mbfd/shared';
import { and, eq } from 'drizzle-orm';

import type { DB } from '../db/index.js';
import {
  bidSessionPolicySnapshots,
  bidYears,
  credentials,
  memberAssignments,
  memberCredentials,
  members,
  positionRules,
  positionStaffingBindings,
  positions,
  ruleBookPositionParticipation,
  ruleBooks,
  staffingPositions,
} from '../db/schema.js';
import {
  type AuthoritativeStaffingBaselineEvaluation,
  evaluateAuthoritativeStaffingBaseline,
} from './authoritative-staffing-baseline.js';
import { type DecodedPositionRule, decodeRuleBookRows } from './position-rule.js';

export interface RuleBookCoverageInput {
  ruleBookVersion: string;
  rules: readonly {
    id?: number;
    ruleBookVersion: string;
    positionId: string;
    templateVersion: string;
    requiredCriteriaJson: string;
    pointsPreferenceJson: string;
    tieBreakChainJson: string;
  }[];
  positions: readonly {
    id: string;
    templateVersion: string;
    bidParticipation: BidParticipation;
    // A701 is an existing, separately tracked legacy exception: the seed has
    // always omitted it from ordinary rule generation. It does not represent
    // an administrative staffing assignment and must not cause a member-pool
    // exclusion. POL-001 remains unresolved independently of POL-015.
    isExcludedFromCount?: boolean;
  }[];
}

export interface RuleBookCoverage {
  ruleBookVersion: string;
  ruleCount: number;
  templateVersion: string | null;
  templateVersionIssues: readonly string[];
  rules: readonly DecodedPositionRule[];
  invalidPositionIds: readonly string[];
  duplicatePositionIds: readonly string[];
  administrativelyAssignedPositionIds: readonly string[];
  legacyExcludedPositionIds: readonly string[];
  expectedBiddablePositionIds: readonly string[];
  validRulePositionIds: readonly string[];
  missingBiddablePositionIds: readonly string[];
  nonBiddablePositionIds: readonly string[];
  unexpectedPositionIds: readonly string[];
  valid: boolean;
}

export interface RuleBookPolicyDiff {
  baselineRuleBookVersion: string;
  candidateRuleBookVersion: string;
  addedRulePositionIds: readonly string[];
  removedRulePositionIds: readonly string[];
  changedRulePositionIds: readonly string[];
  addedParticipationPositionIds: readonly string[];
  removedParticipationPositionIds: readonly string[];
  changedParticipationPositionIds: readonly string[];
  changedPositionIds: readonly string[];
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.trim().length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function comparePositionScopedRows<T extends { positionId: string }>(
  baseline: readonly T[],
  candidate: readonly T[],
  serialize: (row: T) => string,
): {
  addedPositionIds: string[];
  removedPositionIds: string[];
  changedPositionIds: string[];
} {
  const grouped = (rows: readonly T[]) => {
    const byPosition = new Map<string, string[]>();
    for (const row of rows) {
      byPosition.set(row.positionId, [...(byPosition.get(row.positionId) ?? []), serialize(row)]);
    }
    for (const values of byPosition.values()) values.sort((a, b) => a.localeCompare(b));
    return byPosition;
  };
  const baselineByPosition = grouped(baseline);
  const candidateByPosition = grouped(candidate);
  const addedPositionIds: string[] = [];
  const removedPositionIds: string[] = [];
  const changedPositionIds: string[] = [];
  for (const positionId of uniqueSorted([
    ...baselineByPosition.keys(),
    ...candidateByPosition.keys(),
  ])) {
    const before = baselineByPosition.get(positionId);
    const after = candidateByPosition.get(positionId);
    if (before === undefined && after !== undefined) {
      addedPositionIds.push(positionId);
    } else if (before !== undefined && after === undefined) {
      removedPositionIds.push(positionId);
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedPositionIds.push(positionId);
    }
  }
  return { addedPositionIds, removedPositionIds, changedPositionIds };
}

/**
 * Compares two rule books without looking at people or staffing assignments.
 * The result supports a reviewable clone → amend → validate workflow: an
 * operator can prove exactly which annual position identifiers changed before
 * publishing a draft.
 */
export async function loadRuleBookPolicyDiff(
  db: DB,
  baselineRuleBookVersion: string,
  candidateRuleBookVersion: string,
): Promise<RuleBookPolicyDiff> {
  const [baselineRules, candidateRules, baselineParticipation, candidateParticipation] =
    await Promise.all([
      db
        .select()
        .from(positionRules)
        .where(eq(positionRules.ruleBookVersion, baselineRuleBookVersion))
        .all(),
      db
        .select()
        .from(positionRules)
        .where(eq(positionRules.ruleBookVersion, candidateRuleBookVersion))
        .all(),
      db
        .select()
        .from(ruleBookPositionParticipation)
        .where(eq(ruleBookPositionParticipation.ruleBookVersion, baselineRuleBookVersion))
        .all(),
      db
        .select()
        .from(ruleBookPositionParticipation)
        .where(eq(ruleBookPositionParticipation.ruleBookVersion, candidateRuleBookVersion))
        .all(),
    ]);
  const rules = comparePositionScopedRows(baselineRules, candidateRules, (row) =>
    JSON.stringify({
      templateVersion: row.templateVersion,
      requiredCriteriaJson: row.requiredCriteriaJson,
      pointsPreferenceJson: row.pointsPreferenceJson,
      tieBreakChainJson: row.tieBreakChainJson,
      notes: row.notes,
    }),
  );
  const participation = comparePositionScopedRows(
    baselineParticipation,
    candidateParticipation,
    (row) =>
      JSON.stringify({
        templateVersion: row.templateVersion,
        bidParticipation: row.bidParticipation,
        authoritativeSourceRef: row.authoritativeSourceRef,
      }),
  );
  return {
    baselineRuleBookVersion,
    candidateRuleBookVersion,
    addedRulePositionIds: rules.addedPositionIds,
    removedRulePositionIds: rules.removedPositionIds,
    changedRulePositionIds: rules.changedPositionIds,
    addedParticipationPositionIds: participation.addedPositionIds,
    removedParticipationPositionIds: participation.removedPositionIds,
    changedParticipationPositionIds: participation.changedPositionIds,
    changedPositionIds: uniqueSorted([
      ...rules.addedPositionIds,
      ...rules.removedPositionIds,
      ...rules.changedPositionIds,
      ...participation.addedPositionIds,
      ...participation.removedPositionIds,
      ...participation.changedPositionIds,
    ]),
  };
}

/**
 * Validates rule-book membership against the template's explicit Bid
 * participation state. This is intentionally independent of occupancy: a
 * vacant administratively assigned staffing slot still cannot become a Bid
 * opportunity.
 */
export function evaluateRuleBookCoverage(input: RuleBookCoverageInput): RuleBookCoverage {
  const decoded = decodeRuleBookRows(input.rules);
  const templateVersions = uniqueSorted(input.rules.map((rule) => rule.templateVersion));
  const templateVersion = templateVersions.length === 1 ? (templateVersions[0] ?? null) : null;
  const templateVersionIssues: string[] = [];
  if (templateVersions.length === 0) {
    templateVersionIssues.push('missing_template_version');
  } else if (templateVersions.length > 1) {
    templateVersionIssues.push('mixed_template_versions');
  }

  const templatePositions =
    templateVersion === null
      ? []
      : input.positions.filter((position) => position.templateVersion === templateVersion);
  if (templateVersion !== null && templatePositions.length === 0) {
    templateVersionIssues.push('position_template_not_found');
  }

  const byPositionId = new Map(templatePositions.map((position) => [position.id, position]));
  const rawRulePositionIds = uniqueSorted(input.rules.map((rule) => rule.positionId));
  const administrativelyAssignedPositionIds = uniqueSorted(
    templatePositions
      .filter((position) => position.bidParticipation === 'ADMIN_ASSIGNED_NON_BIDDABLE')
      .map((position) => position.id),
  );
  const legacyExcludedPositionIds = uniqueSorted(
    templatePositions
      .filter((position) => position.isExcludedFromCount === true)
      .map((position) => position.id),
  );
  const expectedBiddablePositionIds = uniqueSorted(
    templatePositions
      .filter(
        (position) =>
          position.bidParticipation === 'BIDDABLE' && position.isExcludedFromCount !== true,
      )
      .map((position) => position.id),
  );
  const nonBiddablePositionIds = uniqueSorted(
    rawRulePositionIds.filter((positionId) => {
      const position = byPositionId.get(positionId);
      return (
        position?.bidParticipation === 'ADMIN_ASSIGNED_NON_BIDDABLE' ||
        position?.isExcludedFromCount === true
      );
    }),
  );
  const unexpectedPositionIds = uniqueSorted(
    rawRulePositionIds.filter((positionId) => !byPositionId.has(positionId)),
  );
  const missingBiddablePositionIds = expectedBiddablePositionIds.filter(
    (positionId) => !rawRulePositionIds.includes(positionId),
  );
  const validRulePositionIds = uniqueSorted(
    decoded.rules
      .map((rule) => rule.positionId)
      .filter((positionId) => {
        const position = byPositionId.get(positionId);
        return position?.bidParticipation === 'BIDDABLE' && position.isExcludedFromCount !== true;
      }),
  );

  const valid =
    input.rules.length > 0 &&
    templateVersionIssues.length === 0 &&
    decoded.invalidPositionIds.length === 0 &&
    decoded.duplicatePositionIds.length === 0 &&
    missingBiddablePositionIds.length === 0 &&
    nonBiddablePositionIds.length === 0 &&
    unexpectedPositionIds.length === 0;

  return {
    ruleBookVersion: input.ruleBookVersion,
    ruleCount: input.rules.length,
    templateVersion,
    templateVersionIssues,
    rules: decoded.rules,
    invalidPositionIds: decoded.invalidPositionIds,
    duplicatePositionIds: decoded.duplicatePositionIds,
    administrativelyAssignedPositionIds,
    legacyExcludedPositionIds,
    expectedBiddablePositionIds,
    validRulePositionIds,
    missingBiddablePositionIds,
    nonBiddablePositionIds,
    unexpectedPositionIds,
    valid,
  };
}

/**
 * Parses a persisted immutable snapshot. The caller must fail closed on null:
 * serving a live pool from mutable staffing tables would violate the session
 * boundary.
 */
export function parseBidSessionPolicySnapshot(serialized: string): BidSessionPolicySnapshot | null {
  try {
    return BidSessionPolicySnapshotSchema.parse(JSON.parse(serialized));
  } catch {
    return null;
  }
}

/**
 * Rebuild coverage through the same decoder used for draft validation, but
 * only from material captured in a V3 session snapshot. This makes the
 * session's rules/participation replayable after its source draft advances.
 */
function loadV3SnapshotRuleBookCoverage(
  snapshot: Extract<BidSessionPolicySnapshot, { v: 3 }>,
): RuleBookCoverage {
  return evaluateRuleBookCoverage({
    ruleBookVersion: snapshot.ruleBookVersion,
    rules: snapshot.ruleBookMaterial.rules,
    positions: snapshot.ruleBookMaterial.positions,
  });
}

/**
 * Converts a frozen V3 member to the eligibility engine's minimum input. The
 * engine does not use identity fields; stable non-PII placeholders prevent a
 * later expansion from silently reading mutable member records instead.
 */
export function eligibilityMemberFromFrozen(member: FrozenBidEligibilityMember): {
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: FrozenBidEligibilityMember['rank'];
  rscSeniority: number;
  rankSeniority: number | undefined;
  isProbationary: boolean;
  credentials: Array<{ name: string }>;
} {
  return {
    employeeId: `snapshot-member-${member.memberId}`,
    firstName: '',
    lastName: '',
    rank: member.rank,
    rscSeniority: member.rscSeniority,
    rankSeniority: member.rankSeniority ?? undefined,
    isProbationary: member.isProbationary,
    credentials: member.credentialNames.map((name) => ({ name })),
  };
}

/** Returns the immutable eligibility projection for a fresh V3 snapshot. */
export function frozenEligibilityMemberForSession(
  snapshot: BidSessionPolicySnapshot,
  memberId: number,
): FrozenBidEligibilityMember | null {
  if (snapshot.v !== 3) return null;
  return snapshot.members.find((member) => member.memberId === memberId) ?? null;
}

export interface ActiveRuleBookCoverage {
  kind: 'ready';
  coverage: RuleBookCoverage;
}

export type ActiveRuleBookMissing = { kind: 'missing' } | { kind: 'ambiguous' };

export type ActiveRuleBookCoverageResult = ActiveRuleBookCoverage | ActiveRuleBookMissing;

/** Loads and checks an arbitrary persisted rule book against its position template. */
export async function loadRuleBookCoverage(
  db: DB,
  ruleBookVersion: string,
): Promise<RuleBookCoverage> {
  const [rules, allPositions, participationRows] = await Promise.all([
    db.select().from(positionRules).where(eq(positionRules.ruleBookVersion, ruleBookVersion)).all(),
    db
      .select({
        id: positions.id,
        templateVersion: positions.templateVersion,
        isExcludedFromCount: positions.isExcludedFromCount,
      })
      .from(positions)
      .all(),
    db
      .select({
        positionId: ruleBookPositionParticipation.positionId,
        templateVersion: ruleBookPositionParticipation.templateVersion,
        bidParticipation: ruleBookPositionParticipation.bidParticipation,
      })
      .from(ruleBookPositionParticipation)
      .where(eq(ruleBookPositionParticipation.ruleBookVersion, ruleBookVersion))
      .all(),
  ]);
  const participationByPositionId = new Map(participationRows.map((row) => [row.positionId, row]));
  return evaluateRuleBookCoverage({
    ruleBookVersion,
    rules,
    positions: allPositions.map((position) => {
      const participation = participationByPositionId.get(position.id);
      return {
        ...position,
        // The database FK binds an override to the exact annual position
        // template. Keep the defensive equality check so malformed legacy
        // data cannot silently change a coverage result.
        bidParticipation:
          participation?.templateVersion === position.templateVersion
            ? participation.bidParticipation
            : 'BIDDABLE',
      };
    }),
  });
}

/**
 * The only policy book eligible for a session is the one active book for its
 * bid year. Callers must not pick a draft or archived version opportunistically.
 */
export async function loadActiveRuleBookCoverage(
  db: DB,
  effectiveYear: number,
): Promise<ActiveRuleBookCoverageResult> {
  const active = await db
    .select({ version: ruleBooks.version })
    .from(ruleBooks)
    .where(and(eq(ruleBooks.effectiveYear, effectiveYear), eq(ruleBooks.status, 'active')))
    .all();
  if (active.length === 0) return { kind: 'missing' };
  if (active.length !== 1) return { kind: 'ambiguous' };
  const version = active[0]?.version;
  if (version === undefined) return { kind: 'missing' };
  return { kind: 'ready', coverage: await loadRuleBookCoverage(db, version) };
}

export type BidSessionMode = 'mock' | 'live';

export interface ConfiguredBidYearPolicy {
  bidYear: number;
  configurationRevision: number;
  settings: BidConfigurationSettings;
  ruleBookVersion: string;
  ruleBookRevision: number;
  positionTemplateVersion: string;
  coverage: RuleBookCoverage;
}

export type ConfiguredBidYearPolicyError =
  | 'bid_year_not_found'
  | 'bid_configuration_unconfigured'
  | 'bid_configuration_settings_invalid'
  | 'bid_configuration_rule_book_missing'
  | 'bid_configuration_year_mismatch'
  | 'bid_configuration_template_mismatch'
  | 'bid_configuration_draft_required'
  | 'bid_configuration_frozen_required'
  | 'rule_book_invalid';

export function parseBidConfigurationSettings(
  serialized: string | null,
): BidConfigurationSettings | null {
  if (serialized === null || serialized === '') return null;
  try {
    const parsed = BidConfigurationSettingsSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Resolves only the year-designated configuration source. Session callers
 * never fall back to whichever book happens to be globally active: that
 * behavior lets mocks silently rehearse a different policy than the one being
 * configured for the annual Bid.
 */
export async function loadConfiguredBidYearPolicy(
  db: DB,
  bidYear: number,
  mode: BidSessionMode,
): Promise<
  { ok: true; policy: ConfiguredBidYearPolicy } | { ok: false; code: ConfiguredBidYearPolicyError }
> {
  const year = await db
    .select({
      year: bidYears.year,
      ruleBookVersion: bidYears.ruleBookVersion,
      positionTemplateVersion: bidYears.positionTemplateVersion,
      configJson: bidYears.configJson,
      configurationRevision: bidYears.configurationRevision,
    })
    .from(bidYears)
    .where(eq(bidYears.year, bidYear))
    .get();
  if (year === undefined) return { ok: false, code: 'bid_year_not_found' };
  if (year.ruleBookVersion === null || year.positionTemplateVersion === null) {
    return { ok: false, code: 'bid_configuration_unconfigured' };
  }
  const settings = parseBidConfigurationSettings(year.configJson);
  if (settings === null) return { ok: false, code: 'bid_configuration_settings_invalid' };

  const book = await db
    .select({
      version: ruleBooks.version,
      effectiveYear: ruleBooks.effectiveYear,
      status: ruleBooks.status,
      revision: ruleBooks.revision,
    })
    .from(ruleBooks)
    .where(eq(ruleBooks.version, year.ruleBookVersion))
    .get();
  if (book === undefined) return { ok: false, code: 'bid_configuration_rule_book_missing' };
  if (book.effectiveYear !== bidYear) return { ok: false, code: 'bid_configuration_year_mismatch' };
  if (mode === 'mock' && book.status !== 'draft') {
    return { ok: false, code: 'bid_configuration_draft_required' };
  }
  if (mode === 'live' && book.status !== 'active') {
    return { ok: false, code: 'bid_configuration_frozen_required' };
  }

  const coverage = await loadRuleBookCoverage(db, book.version);
  if (!coverage.valid) return { ok: false, code: 'rule_book_invalid' };
  if (coverage.templateVersion !== year.positionTemplateVersion) {
    return { ok: false, code: 'bid_configuration_template_mismatch' };
  }

  return {
    ok: true,
    policy: {
      bidYear: year.year,
      configurationRevision: year.configurationRevision,
      settings,
      ruleBookVersion: book.version,
      ruleBookRevision: book.revision,
      positionTemplateVersion: year.positionTemplateVersion,
      coverage,
    },
  };
}

export type BidSessionPolicySnapshotPreparation =
  | {
      ok: true;
      snapshot: MaterializedBidSessionPolicySnapshot;
      coverage: RuleBookCoverage;
    }
  | {
      ok: false;
      code:
        | 'no_active_rule_book'
        | 'active_rule_book_ambiguous'
        | 'rule_book_invalid'
        | 'non_biddable_position_staffing_binding_missing'
        | 'non_biddable_position_staffing_binding_not_approved'
        | 'non_biddable_staffing_position_not_approved'
        | 'non_biddable_assignment_ambiguous'
        | ConfiguredBidYearPolicyError;
      positionIds?: readonly string[];
    };

export type ConfiguredRuleBookPublicationPreflight =
  | (Extract<BidSessionPolicySnapshotPreparation, { ok: true }> & {
      /** Exact immutable designation verified before the publish batch. */
      baselineAcceptanceId: string;
      baselineImportId: string;
    })
  | Extract<BidSessionPolicySnapshotPreparation, { ok: false }>
  | {
      ok: false;
      code: 'authoritative_staffing_baseline_required';
      baseline: AuthoritativeStaffingBaselineEvaluation;
    };

/**
 * Read-only publication preflight. It deliberately reuses the same staffing
 * and administrative-position checks used to build a mock session snapshot,
 * so a draft cannot be published when its future mock/live pool would fail
 * closed. This helper does not persist a session or modify the configuration.
 */
export async function preflightConfiguredRuleBookPublication(
  db: DB,
  bidYear: number,
  capturedAtMs: number,
): Promise<ConfiguredRuleBookPublicationPreflight> {
  const baseline = await evaluateAuthoritativeStaffingBaseline(db, bidYear);
  if (baseline.status !== 'PASS') {
    return { ok: false, code: 'authoritative_staffing_baseline_required', baseline };
  }
  const snapshot = await prepareBidSessionPolicySnapshot(db, bidYear, capturedAtMs, 'mock');
  if (!snapshot.ok) return snapshot;
  if (baseline.baselineAcceptanceId === null || baseline.importId === null) {
    return { ok: false, code: 'authoritative_staffing_baseline_required', baseline };
  }
  return {
    ...snapshot,
    baselineAcceptanceId: baseline.baselineAcceptanceId,
    baselineImportId: baseline.importId,
  };
}

function effectiveOn(date: string, effectiveFrom: string, effectiveTo: string | null): boolean {
  return effectiveFrom <= date && (effectiveTo === null || effectiveTo >= date);
}

function snapshotDate(capturedAtMs: number): string {
  return new Date(capturedAtMs).toISOString().slice(0, 10);
}

/**
 * Builds immutable, normalized Bid-pool input from approved staffing and
 * effective-dated authoritative assignments. Missing mapping data fails
 * closed rather than treating a DC vacancy or unknown source identifier as a
 * biddable opportunity.
 */
export async function prepareBidSessionPolicySnapshot(
  db: DB,
  bidYear: number,
  capturedAtMs: number,
  mode: BidSessionMode,
): Promise<BidSessionPolicySnapshotPreparation> {
  const configured = await loadConfiguredBidYearPolicy(db, bidYear, mode);
  if (!configured.ok) return { ok: false, code: configured.code };
  const { policy } = configured;
  const { coverage } = policy;
  const templateVersion = policy.positionTemplateVersion;
  const nonBiddablePositionIds = coverage.administrativelyAssignedPositionIds;

  const [
    bindings,
    staffingRows,
    assignmentRows,
    memberRows,
    credentialRows,
    snapshotRuleRows,
    snapshotPositions,
    snapshotParticipation,
  ] = await Promise.all([
    db
      .select({
        positionId: positionStaffingBindings.positionId,
        staffingPositionId: positionStaffingBindings.staffingPositionId,
        authoritativeSourceRef: positionStaffingBindings.authoritativeSourceRef,
        reviewStatus: positionStaffingBindings.reviewStatus,
      })
      .from(positionStaffingBindings)
      .where(eq(positionStaffingBindings.templateVersion, templateVersion))
      .all(),
    db
      .select({
        id: staffingPositions.id,
        reviewStatus: staffingPositions.reviewStatus,
        activeFrom: staffingPositions.activeFrom,
        activeTo: staffingPositions.activeTo,
      })
      .from(staffingPositions)
      .all(),
    db
      .select({
        id: memberAssignments.id,
        memberId: memberAssignments.memberId,
        staffingPositionId: memberAssignments.staffingPositionId,
        effectiveFrom: memberAssignments.effectiveFrom,
        effectiveTo: memberAssignments.effectiveTo,
      })
      .from(memberAssignments)
      .where(eq(memberAssignments.status, 'active'))
      .all(),
    db
      .select({
        id: members.id,
        bidCategory: members.bidCategory,
        rank: members.rank,
        rscSeniority: members.rscSeniority,
        rankSeniority: members.rankSeniority,
        isProbationary: members.isProbationary,
      })
      .from(members)
      .all(),
    db
      .select({ memberId: memberCredentials.memberId, name: credentials.name })
      .from(memberCredentials)
      .innerJoin(credentials, eq(memberCredentials.credentialId, credentials.id))
      .all(),
    db
      .select({
        ruleBookVersion: positionRules.ruleBookVersion,
        positionId: positionRules.positionId,
        templateVersion: positionRules.templateVersion,
        requiredCriteriaJson: positionRules.requiredCriteriaJson,
        pointsPreferenceJson: positionRules.pointsPreferenceJson,
        tieBreakChainJson: positionRules.tieBreakChainJson,
      })
      .from(positionRules)
      .where(eq(positionRules.ruleBookVersion, policy.ruleBookVersion))
      .all(),
    db
      .select({
        id: positions.id,
        templateVersion: positions.templateVersion,
        isExcludedFromCount: positions.isExcludedFromCount,
        shift: positions.shift,
        station: positions.station,
        unit: positions.unit,
        rankRequired: positions.rankRequired,
        positionName: positions.positionName,
      })
      .from(positions)
      .where(eq(positions.templateVersion, templateVersion))
      .all(),
    db
      .select({
        positionId: ruleBookPositionParticipation.positionId,
        templateVersion: ruleBookPositionParticipation.templateVersion,
        bidParticipation: ruleBookPositionParticipation.bidParticipation,
      })
      .from(ruleBookPositionParticipation)
      .where(eq(ruleBookPositionParticipation.ruleBookVersion, policy.ruleBookVersion))
      .all(),
  ]);

  const bindingByPosition = new Map(bindings.map((binding) => [binding.positionId, binding]));
  const unbound = nonBiddablePositionIds.filter((positionId) => !bindingByPosition.has(positionId));
  if (unbound.length > 0) {
    return {
      ok: false,
      code: 'non_biddable_position_staffing_binding_missing',
      positionIds: unbound,
    };
  }

  const unapprovedBindings = nonBiddablePositionIds.filter(
    (positionId) => bindingByPosition.get(positionId)?.reviewStatus !== 'approved',
  );
  if (unapprovedBindings.length > 0) {
    return {
      ok: false,
      code: 'non_biddable_position_staffing_binding_not_approved',
      positionIds: unapprovedBindings,
    };
  }

  const staffingById = new Map(staffingRows.map((position) => [position.id, position]));
  const asOfDate = snapshotDate(capturedAtMs);
  const notApproved = nonBiddablePositionIds.filter((positionId) => {
    const binding = bindingByPosition.get(positionId);
    const staffing = binding ? staffingById.get(binding.staffingPositionId) : undefined;
    return (
      staffing === undefined ||
      staffing.reviewStatus !== 'approved' ||
      (staffing.activeFrom !== null && staffing.activeFrom > asOfDate) ||
      (staffing.activeTo !== null && staffing.activeTo < asOfDate)
    );
  });
  if (notApproved.length > 0) {
    return {
      ok: false,
      code: 'non_biddable_staffing_position_not_approved',
      positionIds: notApproved,
    };
  }

  const positionByStaffingId = new Map(
    nonBiddablePositionIds.flatMap((positionId) => {
      const binding = bindingByPosition.get(positionId);
      return binding === undefined ? [] : [[binding.staffingPositionId, positionId] as const];
    }),
  );
  const applicableAssignments = assignmentRows.filter(
    (assignment) =>
      positionByStaffingId.has(assignment.staffingPositionId) &&
      effectiveOn(asOfDate, assignment.effectiveFrom, assignment.effectiveTo),
  );
  const assignmentsByPosition = new Map<string, typeof applicableAssignments>();
  const assignmentsByMember = new Map<number, typeof applicableAssignments>();
  for (const assignment of applicableAssignments) {
    const positionId = positionByStaffingId.get(assignment.staffingPositionId);
    if (positionId === undefined) continue;
    assignmentsByPosition.set(positionId, [
      ...(assignmentsByPosition.get(positionId) ?? []),
      assignment,
    ]);
    assignmentsByMember.set(assignment.memberId, [
      ...(assignmentsByMember.get(assignment.memberId) ?? []),
      assignment,
    ]);
  }
  const ambiguousPositionIds = uniqueSorted([
    ...[...assignmentsByPosition.entries()]
      .filter(([, assignments]) => assignments.length > 1)
      .map(([positionId]) => positionId),
    ...[...assignmentsByMember.entries()]
      .filter(([, assignments]) => assignments.length > 1)
      .flatMap(([, assignments]) =>
        assignments.flatMap((assignment) => {
          const positionId = positionByStaffingId.get(assignment.staffingPositionId);
          return positionId === undefined ? [] : [positionId];
        }),
      ),
  ]);
  if (ambiguousPositionIds.length > 0) {
    return {
      ok: false,
      code: 'non_biddable_assignment_ambiguous',
      positionIds: ambiguousPositionIds,
    };
  }

  const assignmentByMember = new Map(
    applicableAssignments.map((assignment) => [assignment.memberId, assignment]),
  );
  const credentialNamesByMember = new Map<number, string[]>();
  for (const credential of credentialRows) {
    credentialNamesByMember.set(credential.memberId, [
      ...(credentialNamesByMember.get(credential.memberId) ?? []),
      credential.name,
    ]);
  }
  for (const [memberId, names] of credentialNamesByMember.entries()) {
    credentialNamesByMember.set(
      memberId,
      [...new Set(names)].sort((left, right) => left.localeCompare(right)),
    );
  }

  const frozenMembers: FrozenBidEligibilityMember[] = memberRows
    .map<FrozenBidEligibilityMember>((member) => {
      const administrativeAssignment = assignmentByMember.get(member.id);
      const eligibility = {
        rank: member.rank,
        isProbationary: member.isProbationary,
        credentialNames: credentialNamesByMember.get(member.id) ?? [],
      };
      if (administrativeAssignment !== undefined) {
        return {
          memberId: member.id,
          pool: 'EXCLUDED',
          rscSeniority: member.rscSeniority,
          rankSeniority: member.rankSeniority,
          exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
          authoritativeAssignmentId: administrativeAssignment.id,
          ...eligibility,
        };
      }

      // The database column is intentionally treated as untrusted here. A
      // value outside the two biddable pools must not become eligible merely
      // because a source constraint was bypassed or a legacy row is malformed.
      const pool: FrozenBidPoolMember['pool'] =
        member.bidCategory === 'OFC' || member.bidCategory === 'FF'
          ? member.bidCategory
          : 'EXCLUDED';
      if (pool === 'EXCLUDED') {
        return {
          memberId: member.id,
          pool,
          rscSeniority: member.rscSeniority,
          rankSeniority: member.rankSeniority,
          exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
          authoritativeAssignmentId: null,
          ...eligibility,
        };
      }
      return {
        memberId: member.id,
        pool,
        rscSeniority: member.rscSeniority,
        rankSeniority: member.rankSeniority,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        ...eligibility,
      };
    })
    .sort((left, right) => left.memberId - right.memberId);

  const participationByPositionId = new Map(
    snapshotParticipation.map((participation) => [participation.positionId, participation]),
  );
  const ruleBookMaterial = {
    v: 1 as const,
    rules: snapshotRuleRows
      .map((row) => ({
        ruleBookVersion: row.ruleBookVersion,
        positionId: row.positionId,
        templateVersion: row.templateVersion,
        requiredCriteriaJson: row.requiredCriteriaJson,
        pointsPreferenceJson: row.pointsPreferenceJson,
        tieBreakChainJson: row.tieBreakChainJson,
      }))
      .sort((left, right) => left.positionId.localeCompare(right.positionId)),
    positions: snapshotPositions
      .map((position) => {
        const participation = participationByPositionId.get(position.id);
        return {
          id: position.id,
          templateVersion: position.templateVersion,
          bidParticipation:
            participation?.templateVersion === position.templateVersion
              ? participation.bidParticipation
              : ('BIDDABLE' as const),
          isExcludedFromCount: position.isExcludedFromCount,
          shift: position.shift,
          station: position.station,
          unit: position.unit,
          rankRequired: position.rankRequired,
          positionName: position.positionName,
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
  };

  const snapshot = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: coverage.ruleBookVersion,
    ruleBookRevision: policy.ruleBookRevision,
    positionTemplateVersion: templateVersion,
    configurationRevision: policy.configurationRevision,
    settings: policy.settings,
    capturedAtMs,
    members: frozenMembers,
    ruleBookMaterial,
  });
  if (snapshot.v !== 3) {
    return { ok: false, code: 'rule_book_invalid' };
  }
  const snapshotCoverage = loadV3SnapshotRuleBookCoverage(snapshot);
  if (
    !snapshotCoverage.valid ||
    snapshotCoverage.templateVersion !== snapshot.positionTemplateVersion
  ) {
    return { ok: false, code: 'rule_book_invalid' };
  }
  return { ok: true, snapshot, coverage: snapshotCoverage };
}

export interface SessionPolicySnapshotLoad {
  snapshot: BidSessionPolicySnapshot | null;
  error: 'missing' | 'invalid' | null;
}

type MaterializedBidSessionPolicySnapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;

/** Reads a frozen session policy without falling back to mutable live data. */
export async function loadBidSessionPolicySnapshot(
  db: DB,
  bidSessionId: string,
): Promise<SessionPolicySnapshotLoad> {
  const row = await db
    .select({
      ruleBookVersion: bidSessionPolicySnapshots.ruleBookVersion,
      positionTemplateVersion: bidSessionPolicySnapshots.positionTemplateVersion,
      ruleBookRevision: bidSessionPolicySnapshots.ruleBookRevision,
      snapshotJson: bidSessionPolicySnapshots.snapshotJson,
      capturedAt: bidSessionPolicySnapshots.capturedAt,
    })
    .from(bidSessionPolicySnapshots)
    .where(eq(bidSessionPolicySnapshots.bidSessionId, bidSessionId))
    .get();
  if (row === undefined) return { snapshot: null, error: 'missing' };
  const snapshot = parseBidSessionPolicySnapshot(row.snapshotJson);
  if (
    snapshot === null ||
    snapshot.ruleBookVersion !== row.ruleBookVersion ||
    snapshot.positionTemplateVersion !== row.positionTemplateVersion ||
    snapshot.capturedAtMs !== row.capturedAt.getTime() ||
    (snapshot.v !== 1 && snapshot.ruleBookRevision !== row.ruleBookRevision) ||
    (snapshot.v === 1 && row.ruleBookRevision !== null)
  ) {
    return { snapshot: null, error: 'invalid' };
  }
  return { snapshot, error: null };
}

export type FrozenSessionBidPolicy =
  | { ok: true; snapshot: MaterializedBidSessionPolicySnapshot; coverage: RuleBookCoverage }
  | {
      ok: false;
      code:
        | 'session_policy_snapshot_missing'
        | 'session_policy_snapshot_invalid'
        | 'session_policy_snapshot_material_missing'
        | 'session_rule_book_invalid'
        | 'session_rule_book_revision_changed'
        | 'session_policy_snapshot_revision_missing';
    };

/**
 * Resolves a session strictly through its captured policy input. A snapshot
 * may reference an archived rule book; immutability, not current activity, is
 * the policy boundary once a session exists.
 */
export async function loadFrozenSessionBidPolicy(
  db: DB,
  bidSessionId: string,
): Promise<FrozenSessionBidPolicy> {
  const loaded = await loadBidSessionPolicySnapshot(db, bidSessionId);
  if (loaded.snapshot === null) {
    return {
      ok: false,
      code:
        loaded.error === 'invalid'
          ? 'session_policy_snapshot_invalid'
          : 'session_policy_snapshot_missing',
    };
  }
  // V1/V2 retain only a pointer to mutable source data. Re-reading that source
  // later would rewrite an established session's effective policy, so those
  // records are intentionally inspectable only and fail closed for Bid engine
  // actions. A session with no immutable material cannot be reconstructed
  // accurately after the fact.
  if (loaded.snapshot.v !== 3) {
    return { ok: false, code: 'session_policy_snapshot_material_missing' };
  }

  const coverage = loadV3SnapshotRuleBookCoverage(loaded.snapshot);
  if (!coverage.valid || coverage.templateVersion !== loaded.snapshot.positionTemplateVersion) {
    return { ok: false, code: 'session_rule_book_invalid' };
  }
  return { ok: true, snapshot: loaded.snapshot, coverage };
}

export type FrozenSessionBidTarget =
  | {
      ok: true;
      snapshot: BidSessionPolicySnapshot;
      coverage: RuleBookCoverage;
      member: FrozenBidPoolMember;
      rule: DecodedPositionRule;
    }
  | {
      ok: false;
      code:
        | 'session_policy_snapshot_missing'
        | 'session_policy_snapshot_invalid'
        | 'session_policy_snapshot_material_missing'
        | 'session_rule_book_invalid'
        | 'session_rule_book_revision_changed'
        | 'session_policy_snapshot_revision_missing'
        | 'member_not_in_bid_pool'
        | 'member_excluded_from_bid_pool'
        | 'position_not_biddable';
      exclusionReason?: FrozenBidPoolMember['exclusionReason'];
    };

/**
 * Resolves a pick target only from the session's frozen pool and its
 * lifecycle-validated rule book. This is the single fail-closed boundary for
 * routes and Durable Object commands that would otherwise bypass ordinary
 * eligibility handling (for example a force-pick).
 */
export async function resolveFrozenSessionBidTarget(
  db: DB,
  input: { bidSessionId: string; memberId: number; positionId: string },
): Promise<FrozenSessionBidTarget> {
  const frozen = await loadFrozenSessionBidPolicy(db, input.bidSessionId);
  if (!frozen.ok) return frozen;

  const member = frozen.snapshot.members.find((entry) => entry.memberId === input.memberId);
  if (member === undefined) return { ok: false, code: 'member_not_in_bid_pool' };
  if (member.pool === 'EXCLUDED') {
    return {
      ok: false,
      code: 'member_excluded_from_bid_pool',
      exclusionReason: member.exclusionReason,
    };
  }

  const rule = frozen.coverage.rules.find((entry) => entry.positionId === input.positionId);
  if (rule === undefined) return { ok: false, code: 'position_not_biddable' };
  return { ...frozen, member, rule };
}

/** Uses the frozen session representation as the only source of pool membership. */
export function bidOrderInputFromSnapshot(snapshot: BidSessionPolicySnapshot): Array<{
  id: number;
  bidCategory: 'OFC' | 'FF' | 'EXCLUDED';
  rscSeniority: number;
  rankSeniority: number | null;
}> {
  return snapshot.members.map((member) => ({
    id: member.memberId,
    bidCategory: member.pool,
    rscSeniority: member.rscSeniority,
    rankSeniority: member.rankSeniority,
  }));
}

export function summarizeBidSessionPolicySnapshot(snapshot: BidSessionPolicySnapshot): {
  officerPoolCount: number;
  firefighterPoolCount: number;
  excludedCount: number;
  administrativeAssignmentExcludedCount: number;
} {
  return {
    officerPoolCount: snapshot.members.filter((member) => member.pool === 'OFC').length,
    firefighterPoolCount: snapshot.members.filter((member) => member.pool === 'FF').length,
    excludedCount: snapshot.members.filter((member) => member.pool === 'EXCLUDED').length,
    administrativeAssignmentExcludedCount: snapshot.members.filter(
      (member) => member.exclusionReason === 'ADMIN_ASSIGNED_NON_BIDDABLE',
    ).length,
  };
}

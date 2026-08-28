import {
  type BidParticipation,
  type BidSessionPolicySnapshot,
  BidSessionPolicySnapshotSchema,
  type FrozenBidPoolMember,
} from '@mbfd/shared';
import { and, eq } from 'drizzle-orm';

import type { DB } from '../db/index.js';
import {
  bidSessionPolicySnapshots,
  memberAssignments,
  members,
  positionRules,
  positionStaffingBindings,
  positions,
  ruleBookPositionParticipation,
  ruleBooks,
  staffingPositions,
} from '../db/schema.js';
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

export type BidSessionPolicySnapshotPreparation =
  | {
      ok: true;
      snapshot: BidSessionPolicySnapshot;
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
        | 'non_biddable_assignment_ambiguous';
      positionIds?: readonly string[];
    };

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
): Promise<BidSessionPolicySnapshotPreparation> {
  const active = await loadActiveRuleBookCoverage(db, bidYear);
  if (active.kind === 'missing') return { ok: false, code: 'no_active_rule_book' };
  if (active.kind === 'ambiguous') return { ok: false, code: 'active_rule_book_ambiguous' };
  const coverage = active.coverage;
  if (!coverage.valid || coverage.templateVersion === null) {
    return { ok: false, code: 'rule_book_invalid' };
  }

  const templateVersion = coverage.templateVersion;
  const nonBiddablePositionIds = coverage.administrativelyAssignedPositionIds;

  const [bindings, staffingRows, assignmentRows, memberRows] = await Promise.all([
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
        rscSeniority: members.rscSeniority,
        rankSeniority: members.rankSeniority,
      })
      .from(members)
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
  const frozenMembers: FrozenBidPoolMember[] = memberRows.map((member) => {
    const administrativeAssignment = assignmentByMember.get(member.id);
    if (administrativeAssignment !== undefined) {
      return {
        memberId: member.id,
        pool: 'EXCLUDED',
        rscSeniority: member.rscSeniority,
        rankSeniority: member.rankSeniority,
        exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
        authoritativeAssignmentId: administrativeAssignment.id,
      };
    }
    if (member.bidCategory === 'EXCLUDED') {
      return {
        memberId: member.id,
        pool: 'EXCLUDED',
        rscSeniority: member.rscSeniority,
        rankSeniority: member.rankSeniority,
        exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
        authoritativeAssignmentId: null,
      };
    }
    return {
      memberId: member.id,
      pool: member.bidCategory,
      rscSeniority: member.rscSeniority,
      rankSeniority: member.rankSeniority,
      exclusionReason: null,
      authoritativeAssignmentId: null,
    };
  });

  const snapshot = BidSessionPolicySnapshotSchema.parse({
    v: 1,
    ruleBookVersion: coverage.ruleBookVersion,
    positionTemplateVersion: templateVersion,
    capturedAtMs,
    members: frozenMembers,
  });
  return { ok: true, snapshot, coverage };
}

export interface SessionPolicySnapshotLoad {
  snapshot: BidSessionPolicySnapshot | null;
  error: 'missing' | 'invalid' | null;
}

/** Reads a frozen session policy without falling back to mutable live data. */
export async function loadBidSessionPolicySnapshot(
  db: DB,
  bidSessionId: string,
): Promise<SessionPolicySnapshotLoad> {
  const row = await db
    .select({
      ruleBookVersion: bidSessionPolicySnapshots.ruleBookVersion,
      positionTemplateVersion: bidSessionPolicySnapshots.positionTemplateVersion,
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
    snapshot.capturedAtMs !== row.capturedAt.getTime()
  ) {
    return { snapshot: null, error: 'invalid' };
  }
  return { snapshot, error: null };
}

export type FrozenSessionBidPolicy =
  | { ok: true; snapshot: BidSessionPolicySnapshot; coverage: RuleBookCoverage }
  | {
      ok: false;
      code:
        | 'session_policy_snapshot_missing'
        | 'session_policy_snapshot_invalid'
        | 'session_rule_book_invalid';
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
  const coverage = await loadRuleBookCoverage(db, loaded.snapshot.ruleBookVersion);
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
        | 'session_rule_book_invalid'
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

/**
 * Compatibility boundary for an already-created, pristine mock only. Fresh
 * sessions are always snapshotted atomically at creation. This helper lets a
 * legacy mock created before migration 0023 acquire a one-time frozen input
 * before any rehearsal action; live sessions never receive this fallback.
 */
export async function captureLegacyMockSessionPolicySnapshot(
  db: DB,
  input: { bidSessionId: string; bidYear: number; capturedAtMs: number },
): Promise<FrozenSessionBidPolicy | BidSessionPolicySnapshotPreparation> {
  const existing = await loadFrozenSessionBidPolicy(db, input.bidSessionId);
  if (existing.ok || existing.code !== 'session_policy_snapshot_missing') return existing;
  const prepared = await prepareBidSessionPolicySnapshot(db, input.bidYear, input.capturedAtMs);
  if (!prepared.ok) return prepared;
  await db
    .insert(bidSessionPolicySnapshots)
    .values({
      bidSessionId: input.bidSessionId,
      ruleBookVersion: prepared.snapshot.ruleBookVersion,
      positionTemplateVersion: prepared.snapshot.positionTemplateVersion,
      snapshotJson: JSON.stringify(prepared.snapshot),
      capturedAt: new Date(input.capturedAtMs),
    })
    .onConflictDoNothing();
  return loadFrozenSessionBidPolicy(db, input.bidSessionId);
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

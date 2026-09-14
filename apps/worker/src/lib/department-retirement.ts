import type {
  DepartmentRetirementAssignment,
  DepartmentRetirementBlocker,
  DepartmentRetirementImpact,
  DepartmentRetirementOrganizationLink,
  DepartmentRetirementOrganizationVersion,
} from '@mbfd/shared/schemas/department-retirement';
import { isIsoCalendarDate } from './personnel-lifecycle.js';

interface PositionRow {
  id: string;
  stableSlotKey: string;
  name: string | null;
  reviewStatus: 'draft' | 'approved' | 'retired';
  activeFrom: string | null;
  activeTo: string | null;
  updatedAt: number;
}

interface LinkRow extends DepartmentRetirementOrganizationLink {
  activeFrom: string | null;
  activeTo: string | null;
}

type AssignmentRow = Omit<DepartmentRetirementAssignment, 'timing'>;
type Version = DepartmentRetirementOrganizationVersion;
type Period = { id: string; from: string; until: string | null };

function assertDate(value: string) {
  if (!isIsoCalendarDate(value)) throw new Error('invalid_effective_on');
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function dayAfter(value: string | null): string | null {
  if (value === null || value === '9999-12-31') return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function intersect(left: Period, right: Period): Period | null {
  const from = left.from > right.from ? left.from : right.from;
  const until =
    left.until === null
      ? right.until
      : right.until === null || left.until < right.until
        ? left.until
        : right.until;
  return until !== null && until <= from ? null : { id: right.id, from, until };
}

function assignmentOverlaps(assignment: AssignmentRow, period: Period) {
  return (
    (assignment.effectiveTo === null || assignment.effectiveTo >= period.from) &&
    (period.until === null || assignment.effectiveFrom < period.until)
  );
}

function assignmentEvidence(
  row: AssignmentRow,
  effectiveOn: string,
): DepartmentRetirementAssignment {
  return {
    ...row,
    timing:
      row.effectiveFrom > effectiveOn
        ? 'future'
        : row.effectiveTo !== null && row.effectiveTo < effectiveOn
          ? 'before_date'
          : 'covers_date',
  };
}

async function loadAssignments(db: D1Database, positionIds: string[]): Promise<AssignmentRow[]> {
  const unique = [...new Set(positionIds)].sort();
  const batches: Promise<D1Result<AssignmentRow>>[] = [];
  // Keep each statement below D1's bound-parameter limit even for large stations.
  for (let offset = 0; offset < unique.length; offset += 80) {
    const ids = unique.slice(offset, offset + 80);
    batches.push(
      db
        .prepare(`SELECT assignment.id, assignment.staffing_position_id AS staffingPositionId,
        assignment.member_id AS memberId, member.first_name AS firstName, member.last_name AS lastName,
        assignment.status, assignment.effective_from AS effectiveFrom, assignment.effective_to AS effectiveTo
        FROM member_assignments assignment JOIN members member ON member.id=assignment.member_id
        WHERE assignment.staffing_position_id IN (${ids.map(() => '?').join(',')})`)
        .bind(...ids)
        .all<AssignmentRow>(),
    );
  }
  return (await Promise.all(batches))
    .flatMap((result) => result.results)
    .sort(
      (left, right) =>
        left.effectiveFrom.localeCompare(right.effectiveFrom) || left.id.localeCompare(right.id),
    );
}

async function loadOrganizationEvidence(db: D1Database) {
  const [versions, links] = await Promise.all([
    db
      .prepare(`SELECT identity.id, identity.kind, version.display_name AS name,
      version.revision, version.parent_id AS parentId, version.status,
      version.effective_on AS effectiveOn, version.evidence_ref AS evidenceRef,
      LEAD(version.effective_on) OVER (PARTITION BY version.unit_id ORDER BY version.effective_on,version.revision) AS nextEffectiveOn
      FROM organization_unit_versions version JOIN organization_units identity ON identity.id=version.unit_id
      ORDER BY identity.id,version.revision`)
      .all<Version>(),
    db
      .prepare(`SELECT link.staffing_position_id AS staffingPositionId, seat.stable_slot_key AS stableSlotKey,
      link.organization_unit_id AS organizationUnitId, link.revision, link.effective_on AS effectiveOn,
      link.evidence_ref AS evidenceRef, seat.active_from AS activeFrom, seat.active_to AS activeTo,
      LEAD(link.effective_on) OVER (PARTITION BY link.staffing_position_id ORDER BY link.effective_on,link.revision) AS nextEffectiveOn
      FROM organization_staffing_links link JOIN staffing_positions seat ON seat.id=link.staffing_position_id
      ORDER BY link.staffing_position_id,link.revision`)
      .all<LinkRow>(),
  ]);
  return { versions: versions.results, links: links.results };
}

function linkEvidence({ activeFrom: _from, activeTo: _to, ...link }: LinkRow) {
  return link;
}

/** Read the existing position retirement precheck and assignment authorization guard; never plan a mutation. */
export async function loadPositionRetirementImpact(
  db: D1Database,
  id: string,
  effectiveOn: string,
): Promise<DepartmentRetirementImpact | null> {
  assertDate(effectiveOn);
  const position = await db
    .prepare(`SELECT id, stable_slot_key AS stableSlotKey, position_name AS name,
    review_status AS reviewStatus, active_from AS activeFrom, active_to AS activeTo, updated_at AS updatedAt
    FROM staffing_positions WHERE id=?`)
    .bind(id)
    .first<PositionRow>();
  if (position === null) return null;
  const [assignments, organization] = await Promise.all([
    loadAssignments(db, [id]),
    loadOrganizationEvidence(db),
  ]);
  const lastActiveOn = previousDate(effectiveOn);
  const blockers: DepartmentRetirementBlocker[] = [];
  if (position.activeFrom !== null && lastActiveOn < position.activeFrom) {
    blockers.push({
      code: 'position_retirement_precedes_active_window',
      recordId: id,
      detail: `The position must retain an active day on or after ${position.activeFrom}.`,
    });
  }
  for (const assignment of assignments) {
    // personnel.ts POSITION_RETIRE precheck includes terminal records covering R.
    const coversDate =
      assignment.status !== 'cancelled' &&
      assignment.effectiveFrom <= effectiveOn &&
      (assignment.effectiveTo === null || assignment.effectiveTo >= effectiveOn);
    // 0021 staffing_positions_no_authorization_change_that_invalidates_assignment
    // also guards all planned/active records beyond the new inclusive active_to.
    const invalidatesAuthorization =
      ['planned', 'active'].includes(assignment.status) &&
      (assignment.effectiveTo === null || assignment.effectiveTo > lastActiveOn);
    if (coversDate || invalidatesAuthorization) {
      blockers.push({
        code: coversDate
          ? 'position_occupied_requires_vacancy'
          : 'position_authorization_invalidates_assignment',
        recordId: assignment.id,
        detail: `Assignment for ${assignment.firstName} ${assignment.lastName} (${assignment.status}) runs from ${assignment.effectiveFrom} through ${assignment.effectiveTo ?? 'an open end'}.`,
      });
    }
  }
  const links = organization.links.filter((link) => link.staffingPositionId === id);
  const related = new Set(
    links.flatMap((link) => (link.organizationUnitId === null ? [] : [link.organizationUnitId])),
  );
  // These are retained dated records, not inferred current placement or blockers.
  let added = true;
  while (added) {
    added = false;
    for (const version of organization.versions) {
      if (related.has(version.id) && version.parentId !== null && !related.has(version.parentId)) {
        related.add(version.parentId);
        added = true;
      }
    }
  }
  return {
    target: {
      kind: 'POSITION',
      id,
      name: position.name ?? position.stableSlotKey,
      stableSlotKey: position.stableSlotKey,
      authorization: {
        reviewStatus: position.reviewStatus,
        activeFrom: position.activeFrom,
        activeTo: position.activeTo,
        updatedAt: position.updatedAt,
      },
    },
    effectiveOn,
    lastActiveOn,
    retirementBlocked: blockers.length > 0,
    blockers,
    assignments: assignments.map((row) => assignmentEvidence(row, effectiveOn)),
    organizationVersions: organization.versions.filter((version) => related.has(version.id)),
    organizationLinks: links.map(linkEvidence),
    retainsHistory: true,
  };
}

/** Exact 0047 dependency predicates, kept alongside the impact read for legacy API parity. */
export async function loadOrganizationRetirementDependencies(
  db: D1Database,
  id: string,
  effectiveOn: string,
) {
  assertDate(effectiveOn);
  const organization = await loadOrganizationEvidence(db);
  const target = organization.versions.filter((version) => version.id === id).at(-1);
  if (target === undefined) return null;
  const [children, seats] = await Promise.all([
    db
      .prepare(`SELECT DISTINCT child.unit_id AS id,child.display_name AS name FROM organization_unit_versions child
      WHERE child.parent_id=? AND child.status='active' AND NOT EXISTS (SELECT 1 FROM organization_unit_versions successor
        WHERE successor.unit_id=child.unit_id AND successor.revision>child.revision AND successor.effective_on<=MAX(?,child.effective_on))
      ORDER BY child.unit_id,child.display_name`)
      .bind(id, effectiveOn)
      .all<{ id: string; name: string }>(),
    db
      .prepare(`SELECT DISTINCT seat.id,seat.stable_slot_key AS stableSlotKey FROM organization_staffing_links link
      JOIN staffing_positions seat ON seat.id=link.staffing_position_id WHERE link.organization_unit_id=?
        AND (seat.active_to IS NULL OR seat.active_to>=MAX(?,link.effective_on))
        AND NOT EXISTS (SELECT 1 FROM organization_staffing_links successor WHERE successor.staffing_position_id=link.staffing_position_id
          AND successor.revision>link.revision AND successor.effective_on<=MAX(?,link.effective_on))
      ORDER BY seat.id`)
      .bind(id, effectiveOn, effectiveOn)
      .all<{ id: string; stableSlotKey: string }>(),
  ]);
  const blockers: DepartmentRetirementBlocker[] = [
    ...children.results.map((child) => ({
      code: 'organization_dependencies_require_review',
      recordId: child.id,
      detail: `Active or future child: ${child.name}.`,
    })),
    ...seats.results.map((seat) => ({
      code: 'organization_dependencies_require_review',
      recordId: seat.id,
      detail: `Active or future linked position: ${seat.stableSlotKey}.`,
    })),
  ];

  // Expand only dated context. Direct guard predicates above remain the sole
  // blocker authority; descendant assignments do not introduce a new guard.
  const periods: Period[] = [{ id, from: effectiveOn, until: null }];
  const visited = new Set<string>();
  const versionKeys = new Set<string>();
  for (let cursor = 0; cursor < periods.length; cursor += 1) {
    const period = periods[cursor];
    if (period === undefined) continue;
    for (const version of organization.versions) {
      if (version.parentId !== period.id || version.status !== 'active') continue;
      const overlap = intersect(period, {
        id: version.id,
        from: version.effectiveOn,
        until: version.nextEffectiveOn,
      });
      if (overlap === null) continue;
      versionKeys.add(`${version.id}:${version.revision}`);
      const key = JSON.stringify(overlap);
      if (visited.has(key)) continue;
      visited.add(key);
      periods.push(overlap);
    }
  }
  const relevantLinks: LinkRow[] = [];
  const positionPeriods: Period[] = [];
  for (const link of organization.links) {
    let included = false;
    for (const period of periods) {
      if (period.id !== link.organizationUnitId) continue;
      const linked = intersect(period, {
        id: link.staffingPositionId,
        from: link.effectiveOn,
        until: link.nextEffectiveOn,
      });
      if (linked === null) continue;
      const authorized = intersect(linked, {
        id: link.staffingPositionId,
        from: link.activeFrom ?? '0000-01-01',
        until: dayAfter(link.activeTo),
      });
      if (authorized === null) continue;
      included = true;
      positionPeriods.push(authorized);
    }
    if (included) relevantLinks.push(link);
  }
  const assignments = await loadAssignments(
    db,
    positionPeriods.map((period) => period.id),
  );
  const impact: DepartmentRetirementImpact = {
    target: {
      kind: target.kind,
      id,
      name: target.name,
      authorization: {
        status: target.status,
        revision: target.revision,
        effectiveOn: target.effectiveOn,
        parentId: target.parentId,
      },
    },
    effectiveOn,
    lastActiveOn: null,
    retirementBlocked: blockers.length > 0,
    blockers,
    assignments: assignments
      .filter((assignment) =>
        positionPeriods.some(
          (period) =>
            period.id === assignment.staffingPositionId && assignmentOverlaps(assignment, period),
        ),
      )
      .map((row) => assignmentEvidence(row, effectiveOn)),
    organizationVersions: organization.versions.filter(
      (version) => version.id === id || versionKeys.has(`${version.id}:${version.revision}`),
    ),
    organizationLinks: relevantLinks.map(linkEvidence),
    retainsHistory: true,
  };
  return {
    asOf: effectiveOn,
    children: children.results,
    seats: seats.results,
    retirementBlocked: impact.retirementBlocked,
    impact,
  };
}

export async function loadOrganizationRetirementImpact(
  db: D1Database,
  id: string,
  effectiveOn: string,
): Promise<DepartmentRetirementImpact | null> {
  return (await loadOrganizationRetirementDependencies(db, id, effectiveOn))?.impact ?? null;
}

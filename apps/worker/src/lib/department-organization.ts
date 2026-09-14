import type { DepartmentRosterPosition } from '@mbfd/shared';

import { isIsoCalendarDate } from './personnel-lifecycle.js';

export interface DepartmentOrganizationUnit {
  id: string;
  kind: 'STATION' | 'GROUP' | 'APPARATUS';
  name: string;
  parentId: string | null;
  status: 'active' | 'retired';
  effectiveOn: string;
  revision: number;
}

export interface DepartmentOrganizationCatalog {
  units: DepartmentOrganizationUnit[];
  links: Array<{ staffingPositionId: string; organizationUnitId: string | null }>;
}

export interface DepartmentPositionOrganization {
  organizationUnitId: string | null;
  stationId: string | null;
  unitId: string | null;
  groupId: string | null;
  station: string | null;
  unit: string | null;
  division: string | null;
}

export class DepartmentOrganizationError extends Error {
  constructor(
    readonly code:
      | 'department_organization_unit_missing'
      | 'department_organization_unit_retired'
      | 'department_organization_cycle',
    readonly staffingPositionId: string,
    readonly organizationUnitId: string,
  ) {
    super(`${code}: position ${staffingPositionId}, organization ${organizationUnitId}`);
    this.name = 'DepartmentOrganizationError';
  }
}

/** Read the existing version ledger, including empty and retired units. */
export async function loadDepartmentOrganization(
  db: D1Database,
  asOf: string,
): Promise<DepartmentOrganizationCatalog> {
  if (!isIsoCalendarDate(asOf)) throw new Error('invalid_as_of');
  const [units, links] = await Promise.all([
    db
      .prepare(`SELECT identity.id, identity.kind, version.display_name AS name,
        version.parent_id AS parentId, version.status,
        version.effective_on AS effectiveOn, version.revision
        FROM organization_units identity
        JOIN organization_unit_versions version ON version.unit_id = identity.id
          AND version.revision = (
            SELECT candidate.revision FROM organization_unit_versions candidate
            WHERE candidate.unit_id = identity.id AND candidate.effective_on <= ?
            ORDER BY candidate.effective_on DESC, candidate.revision DESC LIMIT 1
          )
        ORDER BY identity.kind, version.display_name, identity.id`)
      .bind(asOf)
      .all<DepartmentOrganizationUnit>(),
    db
      .prepare(`SELECT link.staffing_position_id AS staffingPositionId,
        link.organization_unit_id AS organizationUnitId
        FROM organization_staffing_links link
        WHERE link.revision = (
          SELECT candidate.revision FROM organization_staffing_links candidate
          WHERE candidate.staffing_position_id = link.staffing_position_id
            AND candidate.effective_on <= ?
          ORDER BY candidate.effective_on DESC, candidate.revision DESC LIMIT 1
        )
        ORDER BY link.staffing_position_id`)
      .bind(asOf)
      .all<DepartmentOrganizationCatalog['links'][number]>(),
  ]);
  return { units: units.results, links: links.results };
}

/**
 * Only an explicit dated link can supersede legacy staffing labels. Once
 * linked, the reviewed parent chain supplies all location labels: an apparatus
 * moved to a floating group must not retain its former station by accident.
 */
export function resolveDepartmentPositionOrganization(
  position: Pick<DepartmentRosterPosition, 'id' | 'station' | 'unit' | 'division'>,
  catalog: DepartmentOrganizationCatalog,
): DepartmentPositionOrganization {
  const linkedId = catalog.links.find(
    (link) => link.staffingPositionId === position.id,
  )?.organizationUnitId;
  if (linkedId === undefined || linkedId === null) {
    return {
      organizationUnitId: null,
      stationId: null,
      unitId: null,
      groupId: null,
      station: position.station,
      unit: position.unit,
      division: position.division,
    };
  }

  const result: DepartmentPositionOrganization = {
    organizationUnitId: linkedId,
    stationId: null,
    unitId: null,
    groupId: null,
    station: null,
    unit: null,
    division: null,
  };
  const byId = new Map(catalog.units.map((unit) => [unit.id, unit]));
  const visited = new Set<string>();
  let currentId: string | null = linkedId;
  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new DepartmentOrganizationError(
        'department_organization_cycle',
        position.id,
        currentId,
      );
    }
    visited.add(currentId);
    const current = byId.get(currentId);
    if (current === undefined) {
      throw new DepartmentOrganizationError(
        'department_organization_unit_missing',
        position.id,
        currentId,
      );
    }
    if (current.status !== 'active') {
      throw new DepartmentOrganizationError(
        'department_organization_unit_retired',
        position.id,
        currentId,
      );
    }
    if (current.kind === 'STATION' && result.stationId === null) {
      result.stationId = current.id;
      result.station = current.name;
    } else if (current.kind === 'APPARATUS' && result.unitId === null) {
      result.unitId = current.id;
      result.unit = current.name;
    } else if (current.kind === 'GROUP' && result.groupId === null) {
      result.groupId = current.id;
      result.division = current.name;
    }
    currentId = current.parentId;
  }
  return result;
}

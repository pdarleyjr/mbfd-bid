import { deepStrictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type DepartmentOrganizationCatalog,
  DepartmentOrganizationError,
  loadDepartmentOrganization,
  resolveDepartmentPositionOrganization,
} from '../../src/lib/department-organization.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const POSITION = {
  id: 'synthetic-seat',
  station: 'Legacy Station',
  unit: 'Legacy Engine',
  division: 'Legacy Division',
};

describe('Department organization projection', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(`
      INSERT INTO organization_units (id, kind, created_at) VALUES
        ('north', 'GROUP', 1), ('pool', 'GROUP', 1),
        ('station-7', 'STATION', 1), ('station-8', 'STATION', 1),
        ('empty', 'STATION', 1), ('future', 'STATION', 1), ('engine-7', 'APPARATUS', 1);
      INSERT INTO organization_unit_versions
        (unit_id, revision, display_name, parent_id, effective_on, status, evidence_ref, actor_subject, reason, created_at)
      VALUES
        ('north', 1, 'North Group', NULL, '2026-01-01', 'active', 'synthetic-catalog', 'synthetic-admin', 'Synthetic source evidence', 1),
        ('pool', 1, 'Floating Group', NULL, '2026-01-01', 'active', 'synthetic-catalog', 'synthetic-admin', 'Synthetic source evidence', 1),
        ('station-7', 1, 'Station 7', 'north', '2026-01-01', 'active', 'synthetic-catalog', 'synthetic-admin', 'Synthetic source evidence', 1),
        ('station-8', 1, 'Station 8', 'north', '2026-01-01', 'active', 'synthetic-catalog', 'synthetic-admin', 'Synthetic source evidence', 1),
        ('empty', 1, 'Empty Station', NULL, '2026-01-01', 'active', 'synthetic-catalog', 'synthetic-admin', 'Synthetic source evidence', 1),
        ('future', 1, 'Future Station', NULL, '2027-01-01', 'active', 'synthetic-catalog', 'synthetic-admin', 'Synthetic source evidence', 1),
        ('engine-7', 1, 'Engine 7', 'station-7', '2026-01-01', 'active', 'synthetic-catalog', 'synthetic-admin', 'Synthetic source evidence', 1);
      INSERT INTO staffing_positions
        (id, stable_slot_key, shift, station, unit, division, active_from, review_status, created_at, updated_at)
      VALUES ('synthetic-seat', 'SYNTHETIC/E/7/ENGINE', 'E', 'Legacy Station', 'Legacy Engine', 'Legacy Division', '2026-01-01', 'approved', 1, 1);
      INSERT INTO organization_staffing_links
        (staffing_position_id, revision, organization_unit_id, effective_on, evidence_ref, actor_subject, reason, created_at)
      VALUES ('synthetic-seat', 1, 'engine-7', '2026-01-01', 'synthetic-link', 'synthetic-admin', 'Synthetic source evidence', 1);
    `);
  });

  afterEach(async () => teardownTestD1(h));

  it('keeps empty units and explicit identities without any annual policy or database writes', async () => {
    const before = h.sqlite.serialize();
    const catalog = await loadDepartmentOrganization(h.env.DB, '2026-08-28');
    expect(catalog.units).toContainEqual({
      id: 'empty',
      kind: 'STATION',
      name: 'Empty Station',
      parentId: null,
      status: 'active',
      effectiveOn: '2026-01-01',
      revision: 1,
    });
    expect(catalog.units.map((unit) => unit.id)).not.toContain('future');
    expect(catalog.links).toEqual([
      { staffingPositionId: 'synthetic-seat', organizationUnitId: 'engine-7' },
    ]);
    expect(resolveDepartmentPositionOrganization(POSITION, catalog)).toEqual({
      organizationUnitId: 'engine-7',
      stationId: 'station-7',
      unitId: 'engine-7',
      groupId: 'north',
      station: 'Station 7',
      unit: 'Engine 7',
      division: 'North Group',
    });
    expect(
      (await loadDepartmentOrganization(h.env.DB, '2027-01-01')).units.map((unit) => unit.id),
    ).toContain('future');
    deepStrictEqual(h.sqlite.serialize(), before);
  });

  it('changes names and apparatus parents at their effective date while preserving prior views', async () => {
    await h.db.run(`
      INSERT INTO organization_unit_versions
        (unit_id, revision, display_name, parent_id, effective_on, status, evidence_ref, actor_subject, reason, created_at)
      VALUES
        ('station-7', 2, 'Station Seven', 'north', '2026-09-01', 'active', 'synthetic-rename', 'synthetic-admin', 'Synthetic reviewed rename', 2),
        ('engine-7', 2, 'Engine Seven', 'station-8', '2026-09-01', 'active', 'synthetic-move', 'synthetic-admin', 'Synthetic reviewed transfer', 2);
    `);
    const previous = await loadDepartmentOrganization(h.env.DB, '2026-08-31');
    expect(resolveDepartmentPositionOrganization(POSITION, previous)).toMatchObject({
      unit: 'Engine 7',
      station: 'Station 7',
      stationId: 'station-7',
    });
    const effective = await loadDepartmentOrganization(h.env.DB, '2026-09-01');
    expect(effective.units.find((unit) => unit.id === 'station-7')).toMatchObject({
      name: 'Station Seven',
      revision: 2,
    });
    expect(resolveDepartmentPositionOrganization(POSITION, effective)).toMatchObject({
      unitId: 'engine-7',
      unit: 'Engine Seven',
      stationId: 'station-8',
      station: 'Station 8',
    });
  });

  it('retains retired unit evidence at the exact date and rejects malformed as-of dates', async () => {
    await h.db.run(`
      INSERT INTO organization_unit_versions
        (unit_id, revision, display_name, parent_id, effective_on, status, evidence_ref, actor_subject, reason, created_at)
      VALUES ('empty', 2, 'Empty Station', NULL, '2026-08-28', 'retired', 'synthetic-retirement', 'synthetic-admin', 'Synthetic reviewed retirement', 2);
    `);
    expect(
      (await loadDepartmentOrganization(h.env.DB, '2026-08-27')).units.find(
        (unit) => unit.id === 'empty',
      )?.status,
    ).toBe('active');
    expect(
      (await loadDepartmentOrganization(h.env.DB, '2026-08-28')).units.find(
        (unit) => unit.id === 'empty',
      ),
    ).toMatchObject({
      status: 'retired',
      revision: 2,
    });
    await expect(loadDepartmentOrganization(h.env.DB, '2026-02-30')).rejects.toThrow(
      'invalid_as_of',
    );
  });

  it('uses the latest dated explicit unlink and never guesses links from matching legacy labels', async () => {
    await h.db.run(`
      INSERT INTO organization_staffing_links
        (staffing_position_id, revision, organization_unit_id, effective_on, evidence_ref, actor_subject, reason, created_at)
      VALUES ('synthetic-seat', 2, NULL, '2026-09-01', 'synthetic-unlink', 'synthetic-admin', 'Synthetic reviewed unlink', 2);
    `);
    expect(
      resolveDepartmentPositionOrganization(
        POSITION,
        await loadDepartmentOrganization(h.env.DB, '2026-08-31'),
      ).organizationUnitId,
    ).toBe('engine-7');
    const catalog = await loadDepartmentOrganization(h.env.DB, '2026-09-01');
    expect(catalog.links).toEqual([
      { staffingPositionId: 'synthetic-seat', organizationUnitId: null },
    ]);
    expect(resolveDepartmentPositionOrganization(POSITION, catalog)).toEqual({
      organizationUnitId: null,
      stationId: null,
      unitId: null,
      groupId: null,
      station: POSITION.station,
      unit: POSITION.unit,
      division: POSITION.division,
    });
    expect(
      resolveDepartmentPositionOrganization(
        { ...POSITION, id: 'unlinked', station: 'Station 7', unit: 'Engine 7' },
        catalog,
      ),
    ).toMatchObject({
      organizationUnitId: null,
      stationId: null,
      unitId: null,
      station: 'Station 7',
      unit: 'Engine 7',
    });
  });

  it('clears the former station when an explicitly linked apparatus moves into a floating group', async () => {
    await h.db.run(`
      INSERT INTO organization_unit_versions
        (unit_id, revision, display_name, parent_id, effective_on, status, evidence_ref, actor_subject, reason, created_at)
      VALUES ('engine-7', 2, 'Engine 7', 'pool', '2026-09-01', 'active', 'synthetic-pool', 'synthetic-admin', 'Synthetic reviewed pool transfer', 2);
    `);
    expect(
      resolveDepartmentPositionOrganization(
        POSITION,
        await loadDepartmentOrganization(h.env.DB, '2026-09-01'),
      ),
    ).toEqual({
      organizationUnitId: 'engine-7',
      stationId: null,
      unitId: 'engine-7',
      groupId: 'pool',
      station: null,
      unit: 'Engine 7',
      division: 'Floating Group',
    });
  });

  it('fails visibly for missing or retired linked hierarchy and cycles instead of using stale labels', async () => {
    const catalog = await loadDepartmentOrganization(h.env.DB, '2026-08-28');
    const broken: Array<{ catalog: DepartmentOrganizationCatalog; code: string }> = [
      {
        catalog: { ...catalog, units: catalog.units.filter((unit) => unit.id !== 'engine-7') },
        code: 'department_organization_unit_missing',
      },
      {
        catalog: { ...catalog, units: catalog.units.filter((unit) => unit.id !== 'station-7') },
        code: 'department_organization_unit_missing',
      },
      {
        catalog: {
          ...catalog,
          units: catalog.units.map((unit) =>
            unit.id === 'station-7' ? { ...unit, status: 'retired' } : unit,
          ),
        },
        code: 'department_organization_unit_retired',
      },
      {
        catalog: {
          ...catalog,
          units: catalog.units.map((unit) =>
            unit.id === 'north' ? { ...unit, parentId: 'engine-7' } : unit,
          ),
        },
        code: 'department_organization_cycle',
      },
    ];
    for (const candidate of broken) {
      expect(() => resolveDepartmentPositionOrganization(POSITION, candidate.catalog)).toThrow(
        DepartmentOrganizationError,
      );
      expect(() => resolveDepartmentPositionOrganization(POSITION, candidate.catalog)).toThrow(
        candidate.code,
      );
    }
  });
});

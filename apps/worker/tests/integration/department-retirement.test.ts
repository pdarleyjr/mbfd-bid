import { deepStrictEqual } from 'node:assert';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import {
  loadOrganizationRetirementImpact,
  loadPositionRetirementImpact,
} from '../../src/lib/department-retirement.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const R = '2026-09-01';

describe('Department retirement dependency reads', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (1,'synthetic-one','Synthetic','One','FF','FF',1,1,1);
      INSERT INTO staffing_positions (id,stable_slot_key,position_name,review_status,active_from,created_at,updated_at)
        VALUES ('seat','SYNTHETIC/SEAT','Synthetic Firefighter','approved','2026-01-01',1,1);
      INSERT INTO organization_units (id,kind,created_at) VALUES
        ('station','STATION',1),('other','STATION',1),('engine','APPARATUS',1);
      INSERT INTO organization_unit_versions
        (unit_id,revision,display_name,parent_id,effective_on,status,evidence_ref,actor_subject,reason,created_at)
        VALUES
        ('station',1,'Synthetic Station',NULL,'2026-01-01','active','synthetic-source','synthetic-admin','Synthetic fixture',1),
        ('other',1,'Synthetic Other Station',NULL,'2026-01-01','active','synthetic-source','synthetic-admin','Synthetic fixture',1),
        ('engine',1,'Synthetic Engine','station','2026-01-01','active','synthetic-source','synthetic-admin','Synthetic fixture',1);
    `);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  function assignment(status: string, from: string, to: string | null) {
    h.sqlite
      .prepare(`INSERT INTO member_assignments
      (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,effective_to,created_at,updated_at)
      VALUES ('assignment',1,'seat','ADMIN_TRANSFER','synthetic-source',?,?,?,?,1)`)
      .run(status, from, to, 1);
  }

  function link(revision: number, unit: string | null, on: string) {
    h.sqlite
      .prepare(`INSERT INTO organization_staffing_links
      (staffing_position_id,revision,organization_unit_id,effective_on,evidence_ref,actor_subject,reason,created_at)
      VALUES ('seat',?,?,?,'synthetic-link','synthetic-admin','Synthetic fixture',1)`)
      .run(revision, unit, on);
  }

  function engineVersion(revision: number, parent: string, on: string) {
    h.sqlite
      .prepare(`INSERT INTO organization_unit_versions
      (unit_id,revision,display_name,parent_id,effective_on,status,evidence_ref,actor_subject,reason,created_at)
      VALUES ('engine',?,'Synthetic Engine',?,?,'active','synthetic-source','synthetic-admin','Synthetic fixture',1)`)
      .run(revision, parent, on);
  }

  it.each([
    ['active', '2026-01-01', '2026-08-31', false, 'before_date'],
    ['active', '2026-01-01', R, true, 'covers_date'],
    ['planned', '2026-10-01', null, true, 'future'],
    ['cancelled', '2026-10-01', null, false, 'future'],
    ['ended', '2026-01-01', '2026-08-31', false, 'before_date'],
    ['superseded', '2026-01-01', R, true, 'covers_date'],
    ['ended', '2026-10-01', '2026-10-31', false, 'future'],
  ])(
    'matches existing position guards for %s %s through %s',
    async (status, from, to, blocked, timing) => {
      assignment(status as string, from as string, to as string | null);
      const impact = await loadPositionRetirementImpact(h.env.DB, 'seat', R);
      expect(impact).toMatchObject({
        effectiveOn: R,
        lastActiveOn: '2026-08-31',
        retirementBlocked: blocked,
        retainsHistory: true,
        target: { kind: 'POSITION', id: 'seat', authorization: { reviewStatus: 'approved' } },
        assignments: [
          {
            id: 'assignment',
            memberId: 1,
            firstName: 'Synthetic',
            lastName: 'One',
            status,
            timing,
          },
        ],
      });
      expect(impact?.blockers.map((blocker) => blocker.recordId)).toEqual(
        blocked ? ['assignment'] : [],
      );
    },
  );

  it('reports an invalid active window and validates dates before any query', async () => {
    expect(await loadPositionRetirementImpact(h.env.DB, 'seat', '2026-01-01')).toMatchObject({
      retirementBlocked: true,
      blockers: [{ code: 'position_retirement_precedes_active_window', recordId: 'seat' }],
    });
    expect(await loadPositionRetirementImpact(h.env.DB, 'missing', R)).toBeNull();
    expect(await loadOrganizationRetirementImpact(h.env.DB, 'missing', R)).toBeNull();
    const prepare = vi.spyOn(h.env.DB, 'prepare');
    await expect(loadPositionRetirementImpact(h.env.DB, 'seat', '2026-02-30')).rejects.toThrow(
      'invalid_effective_on',
    );
    await expect(
      loadOrganizationRetirementImpact(h.env.DB, 'station', '2026-02-30'),
    ).rejects.toThrow('invalid_effective_on');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('retains position link evidence without inventing an organization-link retirement blocker', async () => {
    link(1, 'engine', '2026-01-01');
    link(2, 'other', '2026-10-01');
    const impact = await loadPositionRetirementImpact(h.env.DB, 'seat', R);
    expect(impact?.retirementBlocked).toBe(false);
    expect(
      impact?.organizationLinks.map((item) => [
        item.revision,
        item.organizationUnitId,
        item.nextEffectiveOn,
      ]),
    ).toEqual([
      [1, 'engine', '2026-10-01'],
      [2, 'other', null],
    ]);
    expect(impact?.organizationVersions.map((version) => version.id)).toEqual([
      'engine',
      'other',
      'station',
    ]);
  });

  it('includes future children, follows descendant assignments, and respects same-date reparent supersession', async () => {
    engineVersion(2, 'other', R);
    engineVersion(3, 'station', '2026-10-01');
    engineVersion(4, 'other', '2026-10-01');
    link(1, 'engine', '2026-01-01');
    assignment('planned', '2026-10-01', null);
    const clear = await loadOrganizationRetirementImpact(h.env.DB, 'station', R);
    expect(clear).toMatchObject({ retirementBlocked: false, blockers: [], assignments: [] });
    engineVersion(5, 'station', '2026-11-01');
    const future = await loadOrganizationRetirementImpact(h.env.DB, 'station', R);
    expect(future).toMatchObject({
      retirementBlocked: true,
      blockers: [{ code: 'organization_dependencies_require_review', recordId: 'engine' }],
      assignments: [{ id: 'assignment', timing: 'future' }],
    });
    expect(
      future?.organizationVersions.filter((row) => row.id === 'engine').map((row) => row.revision),
    ).toEqual([5]);
    expect(future?.organizationLinks.map((row) => row.organizationUnitId)).toEqual(['engine']);
  });

  it('matches current/future direct seat-link guards with unlink supersession and an inclusive seat end', async () => {
    link(1, 'station', '2026-01-01');
    link(2, null, R);
    link(3, 'station', '2026-10-01');
    link(4, 'other', '2026-10-01');
    expect(
      (await loadOrganizationRetirementImpact(h.env.DB, 'station', R))?.blockers.map(
        (row) => row.recordId,
      ),
    ).toEqual(['engine']);
    link(5, 'station', '2026-11-01');
    const future = await loadOrganizationRetirementImpact(h.env.DB, 'station', R);
    expect(future?.blockers.map((row) => row.recordId)).toEqual(['engine', 'seat']);
    h.sqlite
      .prepare(
        "UPDATE staffing_positions SET active_to='2026-10-31',review_status='retired' WHERE id='seat'",
      )
      .run();
    expect(
      (await loadOrganizationRetirementImpact(h.env.DB, 'station', R))?.blockers.map(
        (row) => row.recordId,
      ),
    ).toEqual(['engine']);
    h.sqlite.prepare("UPDATE staffing_positions SET active_to='2026-11-01' WHERE id='seat'").run();
    expect(
      (await loadOrganizationRetirementImpact(h.env.DB, 'station', R))?.blockers.map(
        (row) => row.recordId,
      ),
    ).toEqual(['engine', 'seat']);
  });

  it('keeps the dependency API compatible, authenticated and completely read-only', async () => {
    link(1, 'engine', '2026-01-01');
    assignment('active', '2026-01-01', null);
    const before = h.sqlite.serialize();
    const token = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-one',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    const path = '/api/admin/organization/station/dependencies?as_of=2026-09-01';
    expect((await app.fetch(new Request(`http://x${path}`), h.env)).status).toBe(401);
    const response = await app.fetch(
      new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      h.env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      asOf: R,
      children: [{ id: 'engine', name: 'Synthetic Engine' }],
      seats: [],
      retirementBlocked: true,
      impact: { retainsHistory: true, assignments: [{ id: 'assignment', timing: 'covers_date' }] },
    });
    await loadPositionRetirementImpact(h.env.DB, 'seat', R);
    deepStrictEqual(h.sqlite.serialize(), before);
  });
});

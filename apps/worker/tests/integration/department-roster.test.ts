import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'd'.repeat(64);
const AS_OF = '2026-08-28';
const UPDATED_AT = Date.UTC(2026, 7, 28, 12);
const DEPARTMENT_PATH = '/api/admin/department/current-roster';

interface DepartmentRoster {
  asOf: string;
  updatedAt: number | null;
  positions: Array<{
    id: string;
    shift: string | null;
    station: string | null;
    occupancy: 'occupied' | 'vacant';
    assignment: { id: string; memberId: number } | null;
    member: { id: number; rank: string } | null;
    organization?: unknown;
  }>;
  summary: {
    totalPositions: number;
    occupiedPositions: number;
    vacantPositions: number;
  };
  unassignedMembers: Array<{ id: number; rank: string }>;
}

async function token(role: 'admin' | 'member' = 'admin'): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-admin',
      role,
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

function databaseSnapshot(h: TestD1) {
  const tables = h.sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      h.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all(),
    ]),
  );
}

describe('Year-round Department roster', () => {
  let h: TestD1;

  async function request(query = `as_of=${AS_OF}`, path = DEPARTMENT_PATH) {
    return app.fetch(
      new Request(`http://x${path}?${query}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
  }

  async function roster(asOf = AS_OF): Promise<DepartmentRoster> {
    const response = await request(`as_of=${asOf}`);
    expect(response.status).toBe(200);
    return (await response.json()) as DepartmentRoster;
  }

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(`
      INSERT INTO members
        (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
         is_probationary, employment_status, created_at, updated_at)
      VALUES
        (1, 'synthetic-one', 'Synthetic', 'One', 'FF', 'FF', 1, 0, 'active', ${UPDATED_AT}, ${UPDATED_AT}),
        (2, 'synthetic-two', 'Synthetic', 'Two', 'LT', 'OFC', 2, 0, 'unknown', ${UPDATED_AT}, ${UPDATED_AT}),
        (3, 'synthetic-retired', 'Synthetic', 'Retired', 'FF', 'FF', 3, 0, 'retired', ${UPDATED_AT}, ${UPDATED_AT});
      INSERT INTO staffing_positions
        (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
         active_from, active_to, review_status, created_at, updated_at)
      VALUES
        ('slot-a', 'SYNTHETIC/A/1/ENGINE', 'A', '1', 'Engine 1', 'Firefighter', 'FF', '2026-01-01', NULL, 'approved', ${UPDATED_AT}, ${UPDATED_AT}),
        ('slot-e', 'SYNTHETIC/E/7/ENGINE', 'E', '7', 'Engine 7', 'Lieutenant', 'LT', '2026-01-01', NULL, 'approved', ${UPDATED_AT}, ${UPDATED_AT}),
        ('slot-future', 'SYNTHETIC/E/8/RESCUE', 'E', '8', 'Rescue 8', 'Firefighter', 'FF', '2027-01-01', NULL, 'approved', ${UPDATED_AT}, ${UPDATED_AT}),
        ('slot-retired', 'SYNTHETIC/A/2/ENGINE', 'A', '2', 'Engine 2', 'Firefighter', 'FF', '2026-01-01', '2026-07-31', 'retired', ${UPDATED_AT}, ${UPDATED_AT}),
        ('slot-draft', 'SYNTHETIC/E/9/DRAFT', 'E', '9', 'Engine 9', 'Firefighter', 'FF', '2026-01-01', NULL, 'draft', ${UPDATED_AT}, ${UPDATED_AT});
      INSERT INTO member_assignments
        (id, member_id, staffing_position_id, origin_type, origin_ref, status,
         effective_from, effective_to, created_at, updated_at)
      VALUES
        ('assignment-a', 1, 'slot-a', 'ADMIN_TRANSFER', 'synthetic-one', 'active',
         '2026-01-01', NULL, ${UPDATED_AT}, ${UPDATED_AT});
    `);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  it('requires administrator authority and rejects invalid date/filter inputs', async () => {
    const unauthenticated = await app.fetch(new Request(`http://x${DEPARTMENT_PATH}`), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(unauthenticated.status).toBe(401);
    const member = await app.fetch(
      new Request(`http://x${DEPARTMENT_PATH}`, {
        headers: { Authorization: `Bearer ${await token('member')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(member.status).toBe(403);
    expect((await request('as_of=2026-02-30')).status).toBe(400);
    expect((await request(`as_of=${AS_OF}&shift=%20`)).status).toBe(400);
  });

  it('reads staffing without any annual Bid policy or opportunity query and writes nothing', async () => {
    expect(h.sqlite.prepare('SELECT COUNT(*) AS count FROM bid_years').get()).toEqual({ count: 0 });
    const before = databaseSnapshot(h);
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    const prepared = vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql: string) => {
      if (/\b(?:FROM|JOIN)\s+(?:bid_years|rule_book\w*|positions)\b/i.test(sql)) {
        throw new Error('Department projection consulted annual Bid data');
      }
      if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql)) {
        throw new Error('Department projection attempted a write');
      }
      return prepare(sql);
    });

    const body = await roster();
    expect(prepared).toHaveBeenCalled();
    expect(body.summary).toEqual({ totalPositions: 2, occupiedPositions: 1, vacantPositions: 1 });
    expect(body.updatedAt).toBe(UPDATED_AT);
    expect(body.positions.map((position) => position.id)).toEqual(['slot-a', 'slot-e']);
    expect(body.unassignedMembers).toEqual([expect.objectContaining({ id: 2, rank: 'LT' })]);
    expect(body).not.toHaveProperty('administrativeAssignmentPolicy');
    expect(body.summary).not.toHaveProperty('administrativelyAssignedNonBiddablePositions');
    for (const position of body.positions)
      expect(position).not.toHaveProperty('administrativeAssignment');
    for (const member of body.unassignedMembers) expect(member).not.toHaveProperty('bidCategory');
    expect(databaseSnapshot(h)).toEqual(before);
  });

  it('keeps dynamic shift and station filters and exposes future/retired capacity at exact dates', async () => {
    await h.db.run("UPDATE staffing_positions SET shift='E Shift' WHERE id='slot-e'");
    const filtered = await request(`as_of=${AS_OF}&shift=E&station=7&unit=Engine%207&rank=LT`);
    expect(filtered.status).toBe(200);
    expect(((await filtered.json()) as DepartmentRoster).positions).toEqual([
      expect.objectContaining({ id: 'slot-e', shift: 'E', station: '7', occupancy: 'vacant' }),
    ]);
    const historical = await roster('2026-07-31');
    expect(historical.positions.map((position) => position.id)).toContain('slot-retired');
    const afterRetirement = await roster('2026-08-01');
    expect(afterRetirement.positions.map((position) => position.id)).not.toContain('slot-retired');
    expect((await roster('2026-12-31')).positions.map((position) => position.id)).not.toContain(
      'slot-future',
    );
    expect((await roster('2027-01-01')).positions.map((position) => position.id)).toContain(
      'slot-future',
    );
    for (const projection of [historical, afterRetirement, await roster('2027-01-01')]) {
      expect(projection.positions.map((position) => position.id)).not.toContain('slot-draft');
    }
  });

  it('reports an empty Department without fabricating a source update time', async () => {
    const empty = await setupTestD1();
    try {
      const response = await app.fetch(
        new Request(`http://x${DEPARTMENT_PATH}?as_of=${AS_OF}`, {
          headers: { Authorization: `Bearer ${await token()}` },
        }),
        { ...empty.env, JWT_SIGNING_KEY: KEY },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        asOf: AS_OF,
        updatedAt: null,
        positions: [],
        summary: { totalPositions: 0, occupiedPositions: 0, vacantPositions: 0 },
        unassignedMembers: [],
      });
    } finally {
      await teardownTestD1(empty);
    }
  });

  it('restores pre-event member facts and preserves exact transfer, promotion and separation boundaries', async () => {
    await h.db.run(`
      UPDATE member_assignments SET status='ended', effective_to='2026-09-14' WHERE id='assignment-a';
      INSERT INTO member_assignments
        (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, created_at, updated_at)
      VALUES ('assignment-e', 1, 'slot-e', 'PROMOTION', 'synthetic-promotion', 'planned', '2026-09-15', ${UPDATED_AT}, ${UPDATED_AT});
      INSERT INTO personnel_lifecycle_events
        (id, member_id, kind, effective_on, employment_status_before, employment_status_after,
         rank_before, rank_after, reason, origin, actor_subject, idempotency_key, before_state, after_state, created_at)
      VALUES
        ('promotion-one', 1, 'PROMOTION', '2026-09-15', 'active', 'active', 'FF', 'LT',
         'Synthetic promotion evidence', 'ADMIN', 'synthetic-admin', 'promotion-one',
         '{"rank":"FF","employmentStatus":"active"}', '{"rank":"LT","employmentStatus":"active"}', ${UPDATED_AT}),
        ('separation-two', 2, 'SEPARATION', '2026-09-15', 'unknown', 'separated', 'LT', 'LT',
         'Synthetic separation evidence', 'ADMIN', 'synthetic-admin', 'separation-two',
         '{"rank":"LT","employmentStatus":"unknown"}', '{"rank":"LT","employmentStatus":"separated"}', ${UPDATED_AT});
      UPDATE members SET rank='LT' WHERE id=1;
      UPDATE members SET employment_status='separated' WHERE id=2;
    `);
    const before = databaseSnapshot(h);
    const prior = await roster('2026-09-14');
    expect(prior.positions.find((position) => position.id === 'slot-a')).toMatchObject({
      occupancy: 'occupied',
      assignment: { id: 'assignment-a' },
      member: { id: 1, rank: 'FF' },
    });
    expect(prior.positions.find((position) => position.id === 'slot-e')?.occupancy).toBe('vacant');
    expect(prior.unassignedMembers.map((member) => member.id)).toContain(2);

    const effective = await roster('2026-09-15');
    expect(effective.positions.find((position) => position.id === 'slot-a')?.occupancy).toBe(
      'vacant',
    );
    expect(effective.positions.find((position) => position.id === 'slot-e')).toMatchObject({
      occupancy: 'occupied',
      assignment: { id: 'assignment-e' },
      member: { id: 1, rank: 'LT' },
    });
    expect(effective.unassignedMembers.map((member) => member.id)).not.toContain(2);
    expect(databaseSnapshot(h)).toEqual(before);
  });

  it('retains legacy staffing parity while keeping configured Bid participation in the legacy response', async () => {
    await h.db.run(`
      INSERT INTO bid_years (year, status, rule_book_version) VALUES (2026, 'configuring', '2026.synthetic-department');
      INSERT INTO position_templates (version, effective_year) VALUES ('2026.synthetic-department', 2026);
      INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name)
      VALUES ('synthetic-bid-opportunity', '2026.synthetic-department', 'E', '7', 'Combat', 'Engine 7', 'LT', 'Lieutenant');
      INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.synthetic-department', 2026, 'draft');
      INSERT INTO rule_book_position_participation
        (rule_book_version, position_id, template_version, bid_participation, authoritative_source_ref, created_at)
      VALUES ('2026.synthetic-department', 'synthetic-bid-opportunity', '2026.synthetic-department',
        'ADMIN_ASSIGNED_NON_BIDDABLE', 'synthetic-policy', ${UPDATED_AT});
      INSERT INTO position_staffing_bindings
        (position_id, template_version, staffing_position_id, authoritative_source_ref, review_status, created_at)
      VALUES ('synthetic-bid-opportunity', '2026.synthetic-department', 'slot-e', 'synthetic-policy', 'approved', ${UPDATED_AT});
      UPDATE rule_books SET status='active' WHERE version='2026.synthetic-department';
    `);
    const before = databaseSnapshot(h);
    const department = await roster();
    const legacyResponse = await request(`as_of=${AS_OF}`, '/api/admin/current-roster');
    expect(legacyResponse.status).toBe(200);
    const legacy = (await legacyResponse.json()) as {
      positions: Array<Record<string, unknown>>;
      summary: Record<string, unknown>;
      unassignedMembers: Array<Record<string, unknown>>;
      administrativeAssignmentPolicy: { status: string; ruleBookVersion: string };
    };
    expect(legacy.administrativeAssignmentPolicy).toMatchObject({
      status: 'configured',
      ruleBookVersion: '2026.synthetic-department',
    });
    expect(
      legacy.positions.find((position) => position.id === 'slot-e')?.administrativeAssignment,
    ).toBe(true);
    expect(
      legacy.positions.map(({ administrativeAssignment: _participation, ...position }) => position),
    ).toEqual(department.positions.map(({ organization: _organization, ...position }) => position));
    const { administrativelyAssignedNonBiddablePositions, ...summary } = legacy.summary;
    expect(administrativelyAssignedNonBiddablePositions).toBe(1);
    expect(summary).toEqual(department.summary);
    expect(legacy.unassignedMembers.map(({ bidCategory: _category, ...member }) => member)).toEqual(
      department.unassignedMembers,
    );
    expect(databaseSnapshot(h)).toEqual(before);
  });

  it('projects and filters effective organization names and parents through the Department API', async () => {
    await h.db.run(`
      INSERT INTO organization_units (id, kind, created_at) VALUES
        ('station-7', 'STATION', ${UPDATED_AT}),
        ('station-8', 'STATION', ${UPDATED_AT}),
        ('engine-7', 'APPARATUS', ${UPDATED_AT});
      INSERT INTO organization_unit_versions
        (unit_id, revision, display_name, parent_id, effective_on, status, evidence_ref, actor_subject, reason, created_at)
      VALUES
        ('station-7', 1, 'Station 7', NULL, '2026-01-01', 'active', 'synthetic-organization', 'synthetic-admin', 'Synthetic source evidence', ${UPDATED_AT}),
        ('station-8', 1, 'Station 8', NULL, '2026-01-01', 'active', 'synthetic-organization', 'synthetic-admin', 'Synthetic source evidence', ${UPDATED_AT}),
        ('engine-7', 1, 'Engine 7', 'station-7', '2026-01-01', 'active', 'synthetic-organization', 'synthetic-admin', 'Synthetic source evidence', ${UPDATED_AT}),
        ('engine-7', 2, 'Engine Seven', 'station-8', '2026-09-01', 'active', 'synthetic-organization', 'synthetic-admin', 'Synthetic reviewed transfer', ${UPDATED_AT});
      INSERT INTO organization_staffing_links
        (staffing_position_id, revision, organization_unit_id, effective_on, evidence_ref, actor_subject, reason, created_at)
      VALUES ('slot-e', 1, 'engine-7', '2026-01-01', 'synthetic-link', 'synthetic-admin', 'Synthetic source evidence', ${UPDATED_AT});
    `);
    const before = databaseSnapshot(h);
    expect(
      (await roster('2026-08-31')).positions.find((position) => position.id === 'slot-e'),
    ).toMatchObject({
      station: 'Station 7',
      unit: 'Engine 7',
    });
    expect(
      (await roster('2026-09-01')).positions.find((position) => position.id === 'slot-e'),
    ).toMatchObject({
      station: 'Station 8',
      unit: 'Engine Seven',
    });
    const filtered = await request(
      'as_of=2026-09-01&shift=E&station=Station%208&unit=Engine%20Seven',
    );
    expect(filtered.status).toBe(200);
    expect(
      ((await filtered.json()) as DepartmentRoster).positions.map((position) => position.id),
    ).toEqual(['slot-e']);
    expect(databaseSnapshot(h)).toEqual(before);
  });

  it.each([DEPARTMENT_PATH, '/api/admin/current-roster'])(
    'accepts the full organization display-name bound through %s',
    async (path) => {
      const station = `Synthetic station ${'s'.repeat(142)}`;
      const unit = `Synthetic unit ${'u'.repeat(114)}`;
      const division = `Synthetic group ${'g'.repeat(144)}`;
      expect([station.length, unit.length, division.length]).toEqual([160, 129, 160]);
      await h.db.run(`
        INSERT INTO organization_units (id, kind, created_at) VALUES
          ('long-station', 'STATION', ${UPDATED_AT}),
          ('long-unit', 'APPARATUS', ${UPDATED_AT}),
          ('long-group', 'GROUP', ${UPDATED_AT});
        INSERT INTO organization_unit_versions
          (unit_id, revision, display_name, parent_id, effective_on, status, evidence_ref, actor_subject, reason, created_at)
        VALUES
          ('long-station', 1, '${station}', NULL, '2026-01-01', 'active', 'synthetic', 'synthetic', 'Synthetic name boundary', ${UPDATED_AT}),
          ('long-unit', 1, '${unit}', 'long-station', '2026-01-01', 'active', 'synthetic', 'synthetic', 'Synthetic name boundary', ${UPDATED_AT}),
          ('long-group', 1, '${division}', NULL, '2026-01-01', 'active', 'synthetic', 'synthetic', 'Synthetic name boundary', ${UPDATED_AT});
        INSERT INTO organization_staffing_links
          (staffing_position_id, revision, organization_unit_id, effective_on, evidence_ref, actor_subject, reason, created_at)
        VALUES
          ('slot-e', 1, 'long-unit', '2026-01-01', 'synthetic', 'synthetic', 'Synthetic explicit link', ${UPDATED_AT}),
          ('slot-a', 1, 'long-group', '2026-01-01', 'synthetic', 'synthetic', 'Synthetic explicit link', ${UPDATED_AT});
      `);
      const before = databaseSnapshot(h);
      const response = await request(
        new URLSearchParams({ as_of: AS_OF, station, unit }).toString(),
        path,
      );
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as DepartmentRoster).positions.map((position) => position.id),
      ).toEqual(['slot-e']);
      const groupResponse = await request(
        new URLSearchParams({ as_of: AS_OF, division }).toString(),
        path,
      );
      expect(groupResponse.status).toBe(200);
      expect(
        ((await groupResponse.json()) as DepartmentRoster).positions.map((position) => position.id),
      ).toEqual(['slot-a']);
      expect(
        (
          await request(
            new URLSearchParams({ as_of: AS_OF, station: `${station}s` }).toString(),
            path,
          )
        ).status,
      ).toBe(400);
      expect(databaseSnapshot(h)).toEqual(before);
    },
  );
});

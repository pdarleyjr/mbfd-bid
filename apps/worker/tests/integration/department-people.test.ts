import { createHash } from 'node:crypto';
import type { DepartmentPeopleListResponse, DepartmentPersonDetailResponse } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import * as qualificationLifecycle from '../../src/lib/qualification-lifecycle.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'e'.repeat(64);
const NOW = Date.UTC(2026, 7, 28, 12);
const CREDENTIAL_RECORDED_AT = NOW + 60_000;
const BASE = '/api/admin/department/people';

async function token(role: 'admin' | 'member' = 'admin') {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-001',
      role,
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

describe('Department people facade', () => {
  let h: TestD1;

  function snapshot() {
    return createHash('sha256').update(h.sqlite.serialize()).digest('hex');
  }

  async function request(path = '?as_of=2026-08-31') {
    return app.fetch(
      new Request(`http://x${BASE}${path}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
  }

  async function detail(asOf: string) {
    const response = await request(`/1?as_of=${asOf}`);
    expect(response.status).toBe(200);
    return (await response.json()) as DepartmentPersonDetailResponse;
  }

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(`
      INSERT INTO members
        (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
         rank_seniority, hired_at, promoted_at, employment_status, created_at, updated_at)
      VALUES
        (1, 'synthetic-001', 'Morgan', 'Synthetic', 'LT', 'OFC', 17, 4, '2015-01-01', '2026-09-01', 'active', ${NOW}, ${NOW}),
        (2, 'synthetic-002', 'Taylor', 'Unclassified', 'FF', 'EXCLUDED', 0, NULL, NULL, NULL, 'unknown', ${NOW}, ${NOW});
      INSERT INTO staffing_positions
        (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
         active_from, review_status, created_at, updated_at)
      VALUES
        ('slot-ff', 'SYNTHETIC/A/1/FF', 'A', '1', 'Engine 1', 'Firefighter', 'FF', '2026-01-01', 'approved', ${NOW}, ${NOW}),
        ('slot-lt', 'SYNTHETIC/E/7/LT', 'E', '7', 'Engine 7', 'Lieutenant', 'LT', '2026-01-01', 'approved', ${NOW}, ${NOW});
      INSERT INTO member_assignments
        (id, member_id, staffing_position_id, origin_type, origin_ref, status, effective_from, effective_to, created_at, updated_at)
      VALUES
        ('assignment-before', 1, 'slot-ff', 'ADMIN_TRANSFER', 'synthetic-source-before', 'ended', '2026-01-01', '2026-08-31', ${NOW}, ${NOW}),
        ('assignment-after', 1, 'slot-lt', 'PROMOTION', 'promotion-event', 'planned', '2026-09-01', NULL, ${NOW}, ${NOW});
      INSERT INTO personnel_lifecycle_events
        (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
         employment_status_before, employment_status_after, rank_before, rank_after,
         reason, origin, actor_subject, idempotency_key, before_state, after_state, created_at)
      VALUES ('promotion-event', 1, 'slot-lt', 'assignment-after', 'PROMOTION', '2026-09-01',
        'active', 'active', 'FF', 'LT', 'Synthetic promotion evidence', 'ADMIN', 'synthetic-admin', 'promotion-event',
        '{"rank":"FF","employmentStatus":"active"}', '{"rank":"LT","employmentStatus":"active"}', ${NOW});
      INSERT INTO credentials (id, name) VALUES (10, 'Synthetic EMT'), (20, 'Synthetic HazMat');
      INSERT INTO member_credentials (member_id, credential_id, start_date, expiration_date)
      VALUES (1, 10, '2026-01-01', '2026-09-01');
      INSERT INTO member_qualification_events
        (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind, effective_on, expires_on,
         evidence_source, evidence_reference, reason, actor_subject, idempotency_key, before_state, after_state, created_at)
      VALUES
        ('hazmat-gain', 1, 20, NULL, NULL, 'CERTIFICATION_GAINED', '2026-08-01', '2026-08-31',
         'Synthetic registry', 'SYNTHETIC-HAZMAT', 'Synthetic credential evidence', 'synthetic-admin', 'hazmat-gain', '{}', '{"status":"active"}', ${CREDENTIAL_RECORDED_AT}),
        ('specialty-gain', 1, NULL, 'synthetic-rescue', NULL, 'SPECIALTY_QUALIFIED', '2026-08-01', NULL,
         'Synthetic registry', 'SYNTHETIC-RESCUE', 'Synthetic specialty evidence', 'synthetic-admin', 'specialty-gain', '{}', '{"status":"active"}', ${CREDENTIAL_RECORDED_AT}),
        ('specialty-revoke', 1, NULL, 'synthetic-rescue', 'REVOKED', 'SPECIALTY_QUALIFIED', '2026-09-01', NULL,
         'Synthetic registry', 'SYNTHETIC-RESCUE-END', 'Synthetic terminal evidence', 'synthetic-admin', 'specialty-revoke', '{"status":"active"}', '{"status":"revoked"}', ${CREDENTIAL_RECORDED_AT});
    `);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestD1(h);
  });

  it('requires administrator access and rejects invalid identities, dates, filters and paging', async () => {
    const unauthenticated = await app.fetch(new Request(`http://x${BASE}`), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(unauthenticated.status).toBe(401);
    const member = await app.fetch(
      new Request(`http://x${BASE}/1`, {
        headers: { Authorization: `Bearer ${await token('member')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(member.status).toBe(403);
    for (const path of [
      '/0',
      '/-1',
      '/1.5',
      '/invalid',
      '/9007199254740992',
      '/1?as_of=2026-02-30',
      '?page=0',
      '?page=1.5',
      '?page_size=0',
      '?page_size=201',
      '?employment_status=imaginary',
      `?q=${'x'.repeat(129)}`,
    ]) {
      expect((await request(path)).status, path).toBe(400);
    }
    expect((await request('/99999')).status).toBe(404);
  });

  it('returns actual Department person context without Bid queries or mutations', async () => {
    const before = snapshot();
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql: string) => {
      if (/\b(?:FROM|JOIN)\s+(?:bid_\w+|rule_book\w*|positions|position_templates)\b/i.test(sql))
        throw new Error('Department People consulted Bid data');
      if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql))
        throw new Error('Department People attempted a write');
      return prepare(sql);
    });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const list = (await response.json()) as DepartmentPeopleListResponse;
    expect(list.updatedAt).toBe(NOW);
    expect(list.updatedAtScope).toBe('department_roster_sources');
    expect(list.pagination).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      hasNextPage: false,
    });
    expect(list.people.find((person) => person.id === 1)).toMatchObject({
      employeeId: 'synthetic-001',
      firstName: 'Morgan',
      lastName: 'Synthetic',
      rank: 'FF',
      employmentStatus: 'active',
      serviceRecord: {
        basis: 'current_member_record',
        rscSeniority: 17,
        rankSeniority: 4,
        hiredAt: '2015-01-01',
        promotedAt: '2026-09-01',
      },
      assignments: [
        expect.objectContaining({
          id: 'slot-ff',
          shift: 'A',
          station: '1',
          assignment: expect.objectContaining({ id: 'assignment-before' }),
        }),
      ],
    });
    expect(list.people.find((person) => person.id === 2)?.serviceRecord).toEqual({
      basis: 'current_member_record',
      rscSeniority: null,
      rankSeniority: null,
      hiredAt: null,
      promotedAt: null,
    });
    const selected = await detail('2026-09-01');
    expect(selected.updatedAt).toBe(NOW);
    expect(selected.updatedAtScope).toBe('department_roster_sources');
    expect(selected.history.qualificationEvents[0]?.createdAt).toBe(CREDENTIAL_RECORDED_AT);
    expect(selected.person.rank).toBe('LT');
    expect(selected.history.personnelEvents[0]).toMatchObject({
      id: 'promotion-event',
      reason: 'Synthetic promotion evidence',
      beforeState: { rank: 'FF', employmentStatus: 'active' },
    });
    expect(selected.history.assignments.map((assignment) => assignment.id)).toEqual([
      'assignment-after',
      'assignment-before',
    ]);
    expect(snapshot()).toEqual(before);
  });

  it('shares effective rank/assignment and credential expiry semantics, retaining evidence history', async () => {
    const before = await detail('2026-08-31');
    expect(before.person.rank).toBe('FF');
    expect(before.person.assignments.map((position) => position.id)).toEqual(['slot-ff']);
    expect(
      before.qualifications.certifications.find((credential) => credential.credentialId === 20),
    ).toMatchObject({
      status: 'active',
      origin: 'lifecycle_evidence',
      eventId: 'hazmat-gain',
      evidenceReference: 'SYNTHETIC-HAZMAT',
    });
    expect(before.qualifications.specialties).toEqual([
      expect.objectContaining({ specialtyCode: 'synthetic-rescue', status: 'active' }),
    ]);
    const effective = await detail('2026-09-01');
    expect(effective.person.rank).toBe('LT');
    expect(effective.person.assignments.map((position) => position.id)).toEqual(['slot-lt']);
    expect(
      effective.qualifications.certifications.find((credential) => credential.credentialId === 20)
        ?.status,
    ).toBe('expired');
    expect(
      effective.qualifications.certifications.find((credential) => credential.credentialId === 10)
        ?.status,
    ).toBe('active');
    expect(effective.qualifications.specialties[0]?.status).toBe('revoked');
    expect(
      effective.history.qualificationEvents.find((event) => event.id === 'specialty-revoke')?.kind,
    ).toBe('SPECIALTY_REVOKED');
    expect(
      (await detail('2026-09-02')).qualifications.certifications.find(
        (credential) => credential.credentialId === 10,
      )?.status,
    ).toBe('expired');
    expect(before.history.qualificationEvents).toEqual(effective.history.qualificationEvents);
  });

  it('uses current catalog display names without changing evaluator identity or evidence', async () => {
    await h.db.run(`INSERT INTO credential_catalog_metadata (credential_id, display_name, revision)
      VALUES (10, 'Reviewed EMT definition', 1), (20, 'Reviewed HazMat definition', 2)`);
    const before = snapshot();
    const evaluator = vi.spyOn(qualificationLifecycle, 'deriveMemberQualificationProjection');
    const prepare = h.env.DB.prepare.bind(h.env.DB);
    vi.spyOn(h.env.DB, 'prepare').mockImplementation((sql: string) => {
      if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(sql))
        throw new Error('Department display metadata attempted a write');
      return prepare(sql);
    });
    const result = await detail('2026-08-31');
    expect(result.qualifications.certifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: 10,
          credentialName: 'Reviewed EMT definition',
          origin: 'legacy_projection',
          status: 'active',
        }),
        expect.objectContaining({
          credentialId: 20,
          credentialName: 'Reviewed HazMat definition',
          eventId: 'hazmat-gain',
          status: 'active',
        }),
      ]),
    );
    expect(
      result.history.qualificationEvents.find((event) => event.id === 'hazmat-gain'),
    ).toMatchObject({
      credentialId: 20,
      credentialName: 'Reviewed HazMat definition',
      evidenceReference: 'SYNTHETIC-HAZMAT',
      afterState: { status: 'active' },
    });
    expect(
      evaluator.mock.calls[0]?.[0].events.find((event) => event.credentialId === 20)
        ?.credentialName,
    ).toBe('Synthetic HazMat');
    expect(
      evaluator.mock.calls[0]?.[0].legacyCredentials.find(
        (credential) => credential.credentialId === 10,
      )?.credentialName,
    ).toBe('Synthetic EMT');
    expect(snapshot()).toBe(before);
  });

  it('finds people by real employee identifier or name and filters projected employment status', async () => {
    for (const search of ['SYNTHETIC-001', 'morgan synthetic']) {
      const response = await request(`?as_of=2026-08-31&q=${encodeURIComponent(search)}`);
      const body = (await response.json()) as DepartmentPeopleListResponse;
      expect(body.people.map((person) => person.id)).toEqual([1]);
      expect(body.pagination.total).toBe(1);
    }
    const response = await request('?as_of=2026-08-31&employment_status=unknown');
    expect(
      ((await response.json()) as DepartmentPeopleListResponse).people.map((person) => person.id),
    ).toEqual([2]);
    const none = await request('?q=unmatched-source-name');
    expect(((await none.json()) as DepartmentPeopleListResponse).pagination).toMatchObject({
      total: 0,
      totalPages: 0,
      hasNextPage: false,
    });
  });

  it('uses the effective retirement boundary for member status, assignment and status filters', async () => {
    await h.db.run(`
      UPDATE members SET employment_status='retired', employment_status_effective_on='2026-10-01',
        separation_type='RETIREMENT' WHERE id=1;
      UPDATE member_assignments SET status='ended', effective_to='2026-09-30' WHERE id='assignment-after';
      INSERT INTO personnel_lifecycle_events
        (id, member_id, kind, effective_on, employment_status_before, employment_status_after,
         rank_before, rank_after, separation_type, reason, origin, actor_subject, idempotency_key,
         before_state, after_state, created_at)
      VALUES ('retirement-event', 1, 'RETIREMENT', '2026-10-01', 'active', 'retired', 'LT', 'LT',
        'RETIREMENT', 'Synthetic retirement evidence', 'ADMIN', 'synthetic-admin', 'retirement-event',
        '{"rank":"LT","employmentStatus":"active"}',
        '{"rank":"LT","employmentStatus":"retired","separationType":"RETIREMENT"}', ${NOW});
    `);
    const before = snapshot();
    expect((await detail('2026-09-30')).person).toMatchObject({
      employmentStatus: 'active',
      hasAssignment: true,
      assignments: [expect.objectContaining({ id: 'slot-lt' })],
    });
    expect((await detail('2026-10-01')).person).toMatchObject({
      employmentStatus: 'retired',
      employmentStatusEffectiveOn: '2026-10-01',
      separationType: 'RETIREMENT',
      hasAssignment: false,
      assignments: [],
    });
    for (const [asOf, status] of [
      ['2026-09-30', 'active'],
      ['2026-10-01', 'retired'],
    ]) {
      const response = await request(`?as_of=${asOf}&employment_status=${status}`);
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as DepartmentPeopleListResponse).people.map((person) => person.id),
      ).toEqual([1]);
    }
    expect(snapshot()).toBe(before);
  });

  it('makes every member reachable beyond 500 records with stable explicit pagination', async () => {
    await h.db.run(`
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n < 501)
      INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, employment_status, created_at, updated_at)
      SELECT n+10, 'synthetic-page-' || n, 'Synthetic', printf('Page %03d', n), 'FF', 'FF', n+100, 'active', ${NOW}, ${NOW} FROM numbers;
    `);
    const ids: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const response = await request(`?as_of=2026-08-31&page=${page}&page_size=200`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as DepartmentPeopleListResponse;
      expect(body.pagination).toMatchObject({ total: 503, totalPages: 3, hasNextPage: page < 3 });
      expect(body.people).toHaveLength(page === 3 ? 103 : 200);
      ids.push(...body.people.map((person) => person.id));
    }
    expect(new Set(ids).size).toBe(503);
    expect(ids).toContain(511);
    const beyond = await request('?page=4&page_size=200');
    expect(((await beyond.json()) as DepartmentPeopleListResponse).people).toEqual([]);
  });
});

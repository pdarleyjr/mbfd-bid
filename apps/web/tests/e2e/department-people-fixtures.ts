import type {
  DepartmentEmploymentStatus,
  DepartmentPeopleListResponse,
  DepartmentPerson,
  DepartmentPersonDetailResponse,
  DepartmentRosterProjection,
} from '@mbfd/shared';
import type { Page } from '@playwright/test';
import { CompactSign } from 'jose';

// Synthetic presentation fixtures only. They do not implement lifecycle policy.
export const PEOPLE_DATE = '2026-09-12';
export const AFTER_EVENT_DATE = '2026-10-01';
export const PEOPLE_COUNT = 517;
export const LONG_FIRST = 'Synthetic Alexandria Catherine';
export const LONG_LAST = 'Montgomery-Wellington Emergency Operations Training';
export const RECORDED_AT = Date.UTC(2026, 8, 11, 14, 30);
export const memberId = (ordinal: number) => 981000 + ordinal;
export const employeeId = (ordinal: number) => `SYNTHETIC-DEPT-${String(ordinal).padStart(4, '0')}`;
export const fullName = (person: DepartmentPerson) => `${person.firstName} ${person.lastName}`;

const fixturePeople: DepartmentPerson[] = Array.from({ length: PEOPLE_COUNT }, (_, index) => {
  const ordinal = index + 1;
  const specialStatus: Record<number, DepartmentEmploymentStatus> = {
    2: 'unknown',
    4: 'retired',
    5: 'separated',
    6: 'inactive',
  };
  const person: DepartmentPerson = {
    id: memberId(ordinal),
    employeeId: employeeId(ordinal),
    firstName:
      ordinal === 1
        ? LONG_FIRST
        : ordinal === 7 || ordinal === 8
          ? 'Synthetic Duplicate'
          : 'Synthetic',
    lastName:
      ordinal === 1
        ? LONG_LAST
        : ordinal === 7 || ordinal === 8
          ? 'Same Name'
          : ordinal === PEOPLE_COUNT
            ? 'Beyond Five Hundred'
            : `Family ${String(ordinal).padStart(4, '0')}`,
    rank: ordinal === 3 ? null : ordinal === 1 ? 'LT' : 'FF',
    personnelClassification: ordinal === 3 ? 'CIVILIAN' : 'SWORN',
    employmentStatus: specialStatus[ordinal] ?? 'active',
    employmentStatusEffectiveOn: ordinal === 2 ? null : '2026-08-01',
    separationType: ordinal === 5 ? 'VOLUNTARY' : null,
    hasAssignment: false,
    assignments: [],
    serviceRecord: {
      basis: 'current_member_record',
      rscSeniority: ordinal === 3 ? null : ordinal,
      rankSeniority: ordinal === 3 ? null : ordinal + 10,
      hiredAt: ordinal === 2 ? null : '2017-05-01',
      promotedAt: ordinal === 1 ? '2024-03-01' : null,
    },
  };
  if (ordinal === 1) {
    person.hasAssignment = true;
    person.assignments = [
      {
        id: 'synthetic-dept-position-e-1',
        stableSlotKey: 'synthetic-dept-position-e-1',
        organization: {
          organizationUnitId: 'synthetic-unit-e',
          stationId: 'synthetic-station',
          unitId: 'synthetic-unit-e',
          groupId: null,
        },
        division: 'Synthetic Operations',
        shift: 'E',
        station: 'Synthetic Coastal Operations and Emergency Response Training Annex',
        unit: 'Synthetic Special Operations Rescue and Logistics Unit',
        positionName: 'Synthetic Special Operations Training Lieutenant',
        applicableRank: 'LT',
        reviewStatus: 'approved',
        occupancy: 'occupied',
        temporaryContext: [
          {
            id: 'synthetic-light-duty',
            kind: 'LIGHT_DUTY',
            effectiveOn: '2026-09-01',
            plannedEndOn: '2026-09-20',
            actualEndOn: null,
          },
        ],
        assignment: {
          id: 'synthetic-assignment-e-1',
          memberId: person.id,
          originType: 'ADMIN_TRANSFER',
          status: 'active',
          effectiveFrom: '2026-08-01',
          effectiveTo: null,
        },
        member: {
          id: person.id,
          employeeId: person.employeeId,
          firstName: person.firstName,
          lastName: person.lastName,
          rank: person.rank,
        },
      },
    ];
  }
  return person;
});

export function peopleSnapshot(asOf: string): DepartmentPerson[] {
  // Two explicitly canned read-model snapshots, not a client lifecycle reducer.
  const people = structuredClone(fixturePeople);
  if (asOf === AFTER_EVENT_DATE) {
    const first = people[0];
    if (!first) throw new Error('Synthetic fixture is incomplete');
    first.employmentStatus = 'retired';
    first.employmentStatusEffectiveOn = '2026-09-30';
    first.hasAssignment = false;
    first.assignments = [];
  }
  return people;
}

export function listFixture(url: URL): DepartmentPeopleListResponse {
  const asOf = url.searchParams.get('as_of') ?? PEOPLE_DATE;
  const page = Number(url.searchParams.get('page') ?? 1);
  const pageSize = Number(url.searchParams.get('page_size') ?? 50);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 200
  )
    throw new Error('Unexpected fixture pagination request');
  const search = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('en-US');
  const status = url.searchParams.get('employment_status');
  const people = peopleSnapshot(asOf).filter(
    (person) =>
      (!status || person.employmentStatus === status) &&
      (!search ||
        [
          String(person.id),
          person.employeeId,
          fullName(person),
          `${person.lastName}, ${person.firstName}`,
        ].some((value) => value.toLocaleLowerCase('en-US').includes(search))),
  );
  const totalPages = Math.ceil(people.length / pageSize);
  return {
    asOf,
    updatedAt: RECORDED_AT,
    updatedAtScope: 'department_roster_sources',
    people: people.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      total: people.length,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && totalPages > 0,
    },
  };
}

export function detailFixture(id: number, asOf: string): DepartmentPersonDetailResponse | null {
  const person = peopleSnapshot(asOf).find((candidate) => candidate.id === id);
  if (!person) return null;
  const primary = id === memberId(1);
  return {
    asOf,
    updatedAt: RECORDED_AT,
    updatedAtScope: 'department_roster_sources',
    person,
    qualifications: {
      certifications: primary
        ? [
            {
              credentialId: 991,
              credentialName: 'Synthetic advanced rescue certification',
              status: 'active',
              effectiveOn: '2026-08-01',
              expiresOn: '2027-08-01',
              evidenceSource: 'SYNTHETIC_QA',
              evidenceReference: 'synthetic-evidence-active',
              eventId: 'synthetic-credential-award',
              origin: 'lifecycle_evidence',
            },
            {
              credentialId: 992,
              credentialName: 'Synthetic expired certification',
              status: 'expired',
              effectiveOn: '2024-01-01',
              expiresOn: '2025-01-01',
              evidenceSource: 'SYNTHETIC_QA',
              evidenceReference: 'synthetic-evidence-expired',
              eventId: 'synthetic-credential-expired',
              origin: 'lifecycle_evidence',
            },
            {
              credentialId: 993,
              credentialName: 'Synthetic legacy reference',
              status: 'active',
              effectiveOn: null,
              expiresOn: null,
              evidenceSource: null,
              evidenceReference: null,
              eventId: null,
              origin: 'legacy_projection',
            },
          ]
        : [],
      specialties: primary
        ? [
            {
              specialtyCode: 'SYNTHETIC_RESCUE',
              status: 'active',
              effectiveOn: '2026-08-01',
              expiresOn: null,
              evidenceSource: 'SYNTHETIC_QA',
              evidenceReference: 'synthetic-specialty-evidence',
              eventId: 'synthetic-specialty-award',
            },
          ]
        : [],
    },
    history: {
      personnelEvents: primary
        ? [
            {
              id: 'synthetic-scheduled-retirement',
              memberId: id,
              staffingPositionId: null,
              memberAssignmentId: null,
              kind: 'RETIREMENT',
              effectiveOn: '2026-09-30',
              employmentStatusBefore: 'active',
              employmentStatusAfter: 'retired',
              rankBefore: 'LT',
              rankAfter: 'LT',
              separationType: null,
              reason:
                'Synthetic scheduled retirement remains ledger evidence before its effective date',
              origin: 'ADMIN',
              actorSubject: 'synthetic-operator',
              idempotencyKey: 'synthetic-retirement-key',
              beforeState: { employmentStatus: 'active' },
              afterState: { employmentStatus: 'retired' },
              supersedesEventId: null,
              createdAt: RECORDED_AT,
            },
          ]
        : [],
      assignments: primary
        ? [
            {
              id: 'synthetic-assignment-e-1',
              memberId: id,
              staffingPositionId: 'synthetic-dept-position-e-1',
              originType: 'ADMIN_TRANSFER',
              originRef: 'synthetic-transfer-event',
              sourceObservationId: null,
              status: 'active',
              effectiveFrom: '2026-08-01',
              effectiveTo: null,
              createdAt: RECORDED_AT,
              updatedAt: RECORDED_AT,
            },
          ]
        : [],
      qualificationEvents: primary
        ? [
            {
              id: 'synthetic-credential-award',
              memberId: id,
              credentialId: 991,
              credentialName: 'Synthetic advanced rescue certification',
              specialtyCode: null,
              kind: 'CREDENTIAL_AWARD',
              effectiveOn: '2026-08-01',
              expiresOn: '2027-08-01',
              evidenceSource: 'SYNTHETIC_QA',
              evidenceReference: 'synthetic-evidence-active',
              reason: 'Synthetic verified training record',
              actorSubject: 'synthetic-operator',
              idempotencyKey: 'synthetic-credential-key',
              beforeState: {},
              afterState: { status: 'active' },
              createdAt: RECORDED_AT,
            },
          ]
        : [],
    },
  };
}

export type FixtureRequest = {
  page: number;
  pageSize: number;
  search: string;
  asOf: string;
  employmentStatus: string | null;
  ids: number[];
  total: number;
  totalPages: number;
};
export async function installPeopleFixture(page: Page) {
  const state = {
    writes: [] as string[],
    reads: [] as string[],
    consoleErrors: [] as string[],
    unexpectedReads: [] as string[],
    listRequests: [] as FixtureRequest[],
    detailRequests: [] as { id: number; asOf: string }[],
    failList: false,
    failCredentials: false,
    listGate: null as Promise<void> | null,
    detailGate: null as Promise<void> | null,
    failDetails: new Set<number>(),
  };
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      state.consoleErrors.push(message.text());
    }
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    // Next development diagnostics do not write business data. Keep them blocked
    // while preserving the API write assertion for every application mutation.
    if (url.pathname === '/__nextjs_original-stack-frames') return route.abort();
    if (!['GET', 'HEAD'].includes(request.method())) {
      state.writes.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (url.pathname.startsWith('/api/')) state.reads.push(url.pathname);
    if (url.pathname === '/api/admin/department/people') {
      await state.listGate;
      if (state.failList)
        return route.fulfill({ status: 503, json: { error: 'synthetic_people_unavailable' } });
      const body = listFixture(url);
      state.listRequests.push({
        page: body.pagination.page,
        pageSize: body.pagination.pageSize,
        search: url.searchParams.get('q') ?? '',
        asOf: body.asOf,
        employmentStatus: url.searchParams.get('employment_status'),
        ids: body.people.map((person) => person.id),
        total: body.pagination.total,
        totalPages: body.pagination.totalPages,
      });
      return route.fulfill({ json: body });
    }
    const detail = /^\/api\/admin\/department\/people\/(\d+)$/.exec(url.pathname);
    if (detail) {
      const id = Number(detail[1]);
      const asOf = url.searchParams.get('as_of') ?? PEOPLE_DATE;
      state.detailRequests.push({ id, asOf });
      await state.detailGate;
      if (state.failDetails.has(id))
        return route.fulfill({ status: 503, json: { error: 'synthetic_member_unavailable' } });
      const body = detailFixture(id, asOf);
      return route.fulfill({
        status: body ? 200 : 404,
        json: body ?? { error: 'department_member_not_found' },
      });
    }
    if (url.pathname === '/api/admin/department/current-roster') {
      const asOf = url.searchParams.get('as_of') ?? PEOPLE_DATE;
      const positions = peopleSnapshot(asOf).flatMap((person) => person.assignments);
      const body: DepartmentRosterProjection = {
        asOf,
        updatedAt: RECORDED_AT,
        positions,
        organizationUnits: [
          {
            id: 'synthetic-station',
            kind: 'STATION',
            name: 'Synthetic Coastal Operations and Emergency Response Training Annex',
            parentId: null,
            status: 'active',
            effectiveOn: '2026-08-01',
            revision: 1,
          },
          {
            id: 'synthetic-unit-e',
            kind: 'APPARATUS',
            name: 'Synthetic Special Operations Rescue and Logistics Unit',
            parentId: 'synthetic-station',
            status: 'active',
            effectiveOn: '2026-08-01',
            revision: 1,
          },
        ],
        summary: {
          totalPositions: positions.length,
          occupiedPositions: positions.length,
          vacantPositions: 0,
        },
        unassignedMembers: [],
      };
      return route.fulfill({ json: body });
    }
    if (url.pathname === '/api/admin/credentials') {
      if (state.failCredentials)
        return route.fulfill({ status: 503, json: { error: 'synthetic_credentials_unavailable' } });
      const credentials = [
        {
          id: 991,
          name: 'SYNTHETIC_RESCUE',
          policyName: 'Synthetic advanced rescue certification',
          fyPointsDefault: 17,
          holderCount: 1,
          revision: 1,
          retiredOn: null,
        },
        {
          id: 992,
          name: 'SYNTHETIC_EXPIRED',
          policyName: 'Synthetic expired certification',
          fyPointsDefault: 19,
          holderCount: 0,
          revision: 1,
          retiredOn: null,
        },
      ];
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 500);
      return route.fulfill({
        json: { credentials: credentials.slice(offset, offset + limit), total: credentials.length },
      });
    }
    if (url.pathname === '/api/admin/organization') {
      return route.fulfill({
        json: {
          asOf: url.searchParams.get('as_of') ?? PEOPLE_DATE,
          units: [
            {
              id: 'synthetic-station',
              kind: 'STATION',
              name: 'Synthetic Coastal Operations and Emergency Response Training Annex',
              parentId: null,
              status: 'active',
              effectiveOn: '2026-08-01',
              revision: 1,
              latestRevision: 1,
            },
            {
              id: 'synthetic-unit-e',
              kind: 'APPARATUS',
              name: 'Synthetic Special Operations Rescue and Logistics Unit',
              parentId: 'synthetic-station',
              status: 'active',
              effectiveOn: '2026-08-01',
              revision: 1,
              latestRevision: 1,
            },
          ],
        },
      });
    }
    if (url.pathname === '/api/admin/organization/seats/links') {
      return route.fulfill({
        json: {
          links: [
            {
              staffingPositionId: 'synthetic-dept-position-e-1',
              organizationUnitId: 'synthetic-unit-e',
              revision: 1,
              latestRevision: 1,
            },
          ],
        },
      });
    }
    if (
      url.pathname === '/api/admin/telestaff/imports' ||
      url.pathname === '/api/admin/targetsolutions/imports'
    ) {
      return route.fulfill({ json: { imports: [] } });
    }
    if (url.pathname === '/api/admin/targetsolutions/catalog') {
      return route.fulfill({ json: { credentials: [], mappings: [] } });
    }
    if (url.pathname.startsWith('/api/')) {
      state.unexpectedReads.push(url.pathname);
      return route.fulfill({ status: 501, json: { error: 'unplanned_synthetic_read' } });
    }
    return route.continue();
  });
  const key = process.env.JWT_SIGNING_KEY;
  if (!key)
    throw new Error(
      'Explicit isolated JWT_SIGNING_KEY required; do not use production credentials',
    );
  const now = Math.floor(Date.now() / 1000);
  const token = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({
        sub: 901,
        hub_user_id: 901,
        member_id: 901,
        emp: 'synthetic-department-operator',
        role: 'admin',
        security_version: 1,
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'Operator',
        fresh_auth_at: now,
        authz_checked_at: now,
        iat: now,
        exp: now + 3600,
      }),
    ),
  )
    .setProtectedHeader({ alg: 'HS256' })
    .sign(/^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, 'hex') : new TextEncoder().encode(key));
  const baseURL = process.env.DEPARTMENT_UI_BASE_URL ?? 'http://localhost:3000';
  if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
    throw new Error('Only isolated loopback UI is allowed');
  await page.context().addCookies([
    { name: 'mbfd_pin', value: 'ok', url: baseURL, httpOnly: true, sameSite: 'Strict' },
    { name: 'mbfd_bid_jwt', value: token, url: baseURL, httpOnly: true, sameSite: 'Strict' },
  ]);
  return state;
}

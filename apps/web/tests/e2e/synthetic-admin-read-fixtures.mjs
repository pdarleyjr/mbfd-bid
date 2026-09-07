// Synthetic test data only. Served by the loopback test Worker so Server Components
// receive fixtures too; browser page.route cannot intercept server-side fetches.
const members = [
  {
    id: 1,
    employeeId: '10001',
    firstName: 'Alice',
    lastName: 'Smith',
    rank: 'CPT',
    bidCategory: 'OFC',
    rscSeniority: 1,
    hiredAt: '2000-01-15',
    isProbationary: false,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 2,
    employeeId: '10002',
    firstName: 'Bob',
    lastName: 'Jones',
    rank: 'LT',
    bidCategory: 'OFC',
    rscSeniority: 5,
    hiredAt: '2005-03-20',
    isProbationary: false,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 3,
    employeeId: '10003',
    firstName: 'Carol',
    lastName: 'Reyes',
    rank: 'FF',
    bidCategory: 'FF',
    rscSeniority: 12,
    hiredAt: '2015-07-01',
    isProbationary: true,
    createdAt: null,
    updatedAt: null,
  },
];
const positions = [
  {
    id: 'A-01-FF-1',
    templateVersion: '2026.1',
    shift: 'A',
    station: 'Station 1',
    division: 'Combat',
    unit: 'E1',
    rankRequired: 'FF',
    positionName: 'Engine Driver',
    isFloating: false,
    isVacantByDesign: false,
    isExcludedFromCount: false,
  },
  {
    id: 'A-01-LT-1',
    templateVersion: '2026.1',
    shift: 'A',
    station: 'Station 1',
    division: 'Combat',
    unit: 'E1',
    rankRequired: 'LT',
    positionName: 'Company Officer',
    isFloating: false,
    isVacantByDesign: false,
    isExcludedFromCount: false,
  },
  {
    id: 'B-02-FF-1',
    templateVersion: '2026.1',
    shift: 'B',
    station: 'Station 2',
    division: 'Combat',
    unit: 'E2',
    rankRequired: 'FF',
    positionName: 'Engine Driver',
    isFloating: false,
    isVacantByDesign: false,
    isExcludedFromCount: false,
  },
];
const rules = [
  {
    id: 1,
    ruleBookVersion: '2026.1',
    positionId: 'A-01-FF-1',
    templateVersion: '2026.1',
    requiredCriteria: { certs: ['EMT'] },
    pointsPreference: { weight: 'rsc_seniority' },
    tieBreakChain: ['rsc_seniority', 'hired_at'],
    notes: null,
  },
  {
    id: 2,
    ruleBookVersion: '2026.1',
    positionId: 'A-01-LT-1',
    templateVersion: '2026.1',
    requiredCriteria: { certs: ['EMT', 'Paramedic'] },
    pointsPreference: { weight: 'rsc_seniority' },
    tieBreakChain: ['rsc_seniority'],
    notes: 'Lieutenant rule',
  },
  {
    id: 3,
    ruleBookVersion: '2026.1',
    positionId: 'B-02-FF-1',
    templateVersion: '2026.1',
    requiredCriteria: { certs: ['EMT'] },
    pointsPreference: null,
    tieBreakChain: ['rsc_seniority'],
    notes: null,
  },
];

export function syntheticAdminRead(pathname) {
  if (pathname === '/api/admin/members')
    return { status: 200, body: { members, total: members.length } };
  if (/^\/api\/admin\/members\/\d+$/.test(pathname)) {
    const member = members.find((m) => m.id === Number(pathname.split('/').at(-1)));
    return member
      ? { status: 200, body: { member, credentials: [] } }
      : { status: 404, body: { error: 'not_found' } };
  }
  if (pathname === '/api/admin/positions')
    return { status: 200, body: { positions, templateVersion: '2026.1', count: positions.length } };
  if (pathname === '/api/admin/rules')
    return { status: 200, body: { rules, ruleBookVersion: '2026.1', count: rules.length } };
  if (pathname === '/api/admin/bid-configuration/2026')
    return {
      status: 200,
      body: {
        configuration: {
          bidYear: 2026,
          bidYearStatus: 'configuring',
          ruleBookVersion: '2026.1',
          positionTemplateVersion: '2026.1',
          configurationRevision: 1,
          ruleBookRevision: 1,
          settings: { v: 3 },
          lifecycle: 'DRAFT',
        },
      },
    };
  return null;
}

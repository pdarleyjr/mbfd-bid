// Only the loopback E2E Worker imports this fixture. It cannot reach D1 or production.
const sessions = new Map();
const positions = [
  {
    id: 'A-fixture',
    shift: 'A',
    station: 'Station 2',
    unit: 'Engine 2',
    rankRequired: 'CPT',
    positionName: 'Captain',
  },
  {
    id: 'B-fixture',
    shift: 'B',
    station: 'Station 4',
    unit: 'Engine 4',
    rankRequired: 'CPT',
    positionName: 'Captain',
  },
];
const members = {
  1: {
    id: 1,
    employeeId: 'synthetic-1',
    firstName: 'Current',
    lastName: 'Fixture',
    rank: 'CPT',
    historicalContext: {
      year: 2025,
      evidenceStatus: 'RECORDED',
      historicalPositionId: 'old-A109',
      positionLabel: 'Historical Rescue Lieutenant',
      shift: 'A',
      station: 'Station 1',
      unit: 'Rescue 1',
      aDayGroup: 'GR4',
      sourceName: 'Synthetic historical evidence',
      sourceLocation: 'synthetic row 9',
      sourceSha256: 'synthetic',
      archiveSha256: 'synthetic',
    },
  },
  2: {
    id: 2,
    employeeId: 'synthetic-2',
    firstName: 'Waiting',
    lastName: 'Fixture',
    rank: 'CPT',
    historicalContext: {
      year: 2025,
      evidenceStatus: 'UNLINKED',
      historicalPositionId: null,
      positionLabel: null,
      shift: null,
      station: null,
      unit: null,
      aDayGroup: null,
      sourceName: null,
      sourceLocation: null,
      sourceSha256: null,
      archiveSha256: null,
    },
  },
};
export function operatorWorkspaceFixture(url) {
  const id =
    url.pathname === '/api/board'
      ? url.searchParams.get('bidSessionId')
      : url.pathname.match(/^\/api\/admin\/bid-session\/([^/]+)\/specialty-live$/)?.[1];
  if (!id?.startsWith('operator-workspace-e2e-')) return null;
  const state = sessions.get(id) ?? { sequence: 4 };
  sessions.set(id, state);
  if (url.pathname === '/api/board')
    return {
      bidSessionId: id,
      lastSeq: state.sequence,
      currentPhase: 'position_bid',
      currentBidderId: 1,
      currentBidder: { ...members[1], memberId: 1, ordinal: 1, pool: 'OFC' },
      onDeck: [{ ...members[2], memberId: 2, ordinal: 2, pool: 'OFC' }],
      members,
      fills: {},
      bidOrder: [
        { ordinal: 1, memberId: 1, pool: 'OFC' },
        { ordinal: 2, memberId: 2, pool: 'OFC' },
      ],
      bidOrderPreview: false,
      isMock: true,
      mockControlRevision: 1,
      sessionStartedAt: Date.now() - 60_000,
      turnStartedAtMs: Date.now(),
      turnTimerSeconds: 180,
      positions,
      annual: { unresolvedMemberIds: [], returnedAtCurrentSequence: [] },
      advisory: null,
    };
  return {
    bid_session_id: id,
    sequence: state.sequence,
    current_phase: 'position_bid',
    a_day_selection: 'SIMULTANEOUS',
    a_day_combat_groups: ['G1', 'G2', 'G3', 'G4'],
    current_bidder: { member_id: 1, first_name: 'Current', last_name: 'Fixture', rank: 'CPT' },
    selection_stage: {
      id: 'captains',
      label: 'Captain selection',
      opportunity_position_ids: positions.map((p) => p.id),
      eligible_position_ids: positions.map((p) => p.id),
      all_opportunities_filled: false,
      next_stage: null,
    },
    remaining_order: [1, 2],
    fills: {},
    specialties: [],
    active: null,
  };
}

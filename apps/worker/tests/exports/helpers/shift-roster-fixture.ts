import { BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import { emptyBidSessionState } from '../../../src/durable/bid-session-state.js';

export const SHIFT_EXPORT_SESSION = '01HZZ000000000000000SHIFT01';

export function shiftExportFixture() {
  const positions = [
    ['A101', 'A', '1', 'Engine 1', 'CPT'],
    ['A102', 'A', '1', '=HYPERLINK("https://invalid.example")', 'FF'],
    ['B101', 'B', '2', 'Rescue 2', 'LT'],
    ['C999', 'C', '3', 'Prevention', 'DC'],
    ['D101', 'D', 'Days', 'Special Events', 'CPT'],
  ] as const;
  const parsed = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: '2026.export-test',
    ruleBookRevision: 0,
    positionTemplateVersion: '2026.export-topology',
    configurationRevision: 4,
    settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
    capturedAtMs: 1,
    members: [1, 2, 3].map((memberId) => ({
      memberId,
      pool: 'OFC',
      rscSeniority: memberId,
      rankSeniority: memberId,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      rank: memberId === 2 ? 'LT' : 'CPT',
      isProbationary: false,
      credentialNames: ['DO_NOT_EXPORT_PRIVATE_QUALIFICATION'],
    })),
    operatorIdentityProjection: [1, 2, 3].map((memberId) => ({
      memberId,
      employeeId: `PRIVATE_EMPLOYEE_${memberId}`,
      firstName: memberId === 1 ? 'Frozen <Captain>' : `Frozen ${memberId}`,
      lastName: 'Member & Saved',
      rank: memberId === 2 ? 'LT' : 'CPT',
    })),
    ruleBookMaterial: {
      v: 1,
      positions: positions.map(([id, shift, station, unit, rankRequired]) => ({
        id,
        templateVersion: '2026.export-topology',
        bidParticipation: id === 'C999' ? 'ADMIN_ASSIGNED_NON_BIDDABLE' : 'BIDDABLE',
        isExcludedFromCount: false,
        shift,
        station,
        unit,
        rankRequired,
        positionName: id === 'C999' ? 'Division Chief of Prevention' : `Position ${id}`,
      })),
      rules: positions
        .filter(([id]) => id !== 'C999')
        .map(([id, , , , rank]) => ({
          ruleBookVersion: '2026.export-test',
          positionId: id,
          templateVersion: '2026.export-topology',
          requiredCriteriaJson: JSON.stringify({ rank: [rank], credentials: [], custom: [] }),
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
        })),
    },
  });
  if (parsed.v !== 3) throw new Error('fixture must be V3');
  const state = {
    ...emptyBidSessionState(SHIFT_EXPORT_SESSION),
    currentPhase: 'position_bid' as const,
    lastSeq: 7,
    fills: {
      A101: {
        memberId: 1,
        ordinal: 1,
        bidId: 'award-one',
        forced: { commandId: 'force-one', actorMemberId: 3, reason: '', atMs: 1 },
        aDayDeferral: { commandId: 'force-one', actorMemberId: 3, reason: '', positionId: 'A101' },
      },
      B101: { memberId: 2, ordinal: 2, bidId: 'award-two', aDay: 'G2' as const },
    },
    live: {
      currentStageId: null,
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
      exceptionalAssignments: [
        {
          assignmentId: 'temporary-one',
          commandId: 'duty-one',
          memberId: 3,
          roleLabel: 'Division Chief of Prevention',
          positionId: 'C999',
          actorMemberId: 3,
          reason: '',
          assignedAtMs: 1,
          releasedAtMs: null,
          releaseCommandId: null,
        },
      ],
    },
  };
  return {
    sessionId: SHIFT_EXPORT_SESSION,
    year: 2026,
    isMock: true,
    phase: 'position_bid',
    snapshot: parsed,
    validPositionIds: new Set(['A101', 'A102', 'B101', 'D101']),
    state,
    legacyAwards: [],
    scope: 'ALL' as const,
    generatedAt: '2026-10-04T12:00:00.000Z',
  };
}

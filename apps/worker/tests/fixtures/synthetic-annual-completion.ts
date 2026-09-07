import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import type { CanonicalAnnualCompletionSource } from '../../src/lib/annual-completion-result.js';

// Synthetic test-only completion material. This is not historical acceptance evidence.
export function syntheticAnnualCompletionSource(
  overrides: Partial<CanonicalAnnualCompletionSource> = {},
): CanonicalAnnualCompletionSource {
  return {
    session: { id: 'annual-real-2027', mode: 'REAL', bidYear: 2027 },
    completion: {
      commandId: 'completion-command-001',
      revision: 12,
      completedAtMs: 1_800_000_000_000,
      receiptIntegrity: 'VERIFIED',
    },
    frozen: {
      ruleBookVersion: '2027.1',
      topologyReference: 'topology-2027.1',
      staffingReference: 'staffing-2027.1',
      members: [
        { memberId: 101, rank: 'FF' },
        { memberId: 202, rank: 'FF' },
      ],
      positions: [
        {
          id: 'P-ENGINE-1',
          shift: 'A',
          station: '1',
          unit: 'Engine',
          position: 'Firefighter',
          specialty: null,
        },
        {
          id: 'P-RESCUE-1',
          shift: 'B',
          station: '2',
          unit: 'Rescue',
          position: 'Rescue Firefighter',
          specialty: 'RESCUE',
        },
        {
          id: 'P-RESCUE-2',
          shift: 'B',
          station: '2',
          unit: 'Rescue',
          position: 'Rescue Firefighter',
          specialty: 'RESCUE',
        },
      ],
    },
    state: {
      ...emptyBidSessionState('annual-real-2027'),
      currentPhase: 'complete',
      lastSeq: 12,
      fills: {
        'P-ENGINE-1': { memberId: 101, ordinal: 1, bidId: 'award-original' },
        'P-RESCUE-1': { memberId: 202, ordinal: 2, bidId: 'award-final' },
      },
      aDay: {
        groupCaps: {
          A: {
            G1: { min: 0, max: 10, officersRequired: 0 },
            G2: { min: 0, max: 10, officersRequired: 0 },
            G3: { min: 0, max: 10, officersRequired: 0 },
            G4: { min: 0, max: 10, officersRequired: 0 },
          },
          B: {
            G1: { min: 0, max: 10, officersRequired: 0 },
            G2: { min: 0, max: 10, officersRequired: 0 },
            G3: { min: 0, max: 10, officersRequired: 0 },
            G4: { min: 0, max: 10, officersRequired: 0 },
          },
          C: {
            G1: { min: 0, max: 10, officersRequired: 0 },
            G2: { min: 0, max: 10, officersRequired: 0 },
            G3: { min: 0, max: 10, officersRequired: 0 },
            G4: { min: 0, max: 10, officersRequired: 0 },
          },
        },
        weekdayCaps: {},
        picks: [
          {
            memberId: 101,
            shift: 'A',
            aDay: 'G1',
            pickedAtMs: 1_799_999_999_000,
            forced: false,
            adminActorId: null,
          },
          {
            memberId: 202,
            shift: 'B',
            aDay: 'G2',
            pickedAtMs: 1_799_999_999_001,
            forced: false,
            adminActorId: null,
          },
        ],
        bidOrder: [101, 202],
        cursor: 2,
        phase1: [
          [101, { positionId: 'P-ENGINE-1', shift: 'A' }],
          [202, { positionId: 'P-RESCUE-1', shift: 'B' }],
        ],
      },
      annual: {
        preferenceSheets: [],
        contactAttempts: [],
        unresolvedMemberIds: [],
        returnedAtCurrentSequence: [],
        returningMemberId: null,
        checkpoint: null,
        completion: { readyForFinalizationAtMs: 1_800_000_000_000, actorMemberId: 99 },
      },
    },
    amendmentLinks: [{ originalBidId: 'award-superseded', replacementBidId: 'award-final' }],
    ...overrides,
  };
}

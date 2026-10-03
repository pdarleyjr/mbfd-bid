import type { FrozenLiveBidPolicy } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AudienceQueueState,
  loadAudienceCurrentAssignment,
  remainingAudienceQueue,
} from '../../src/lib/audience-bid-context.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const policy = {
  dispositions: [{ disposition: 'SKIP', terminal: false, retainsLaterSelectionRights: true }],
  annualOperations: {
    aDay: {
      execution: {
        timing: 'SIMULTANEOUS',
        timingExceptions: [
          { positionIds: ['A601', 'B213', 'C203'], timing: 'AFTER_POSITION_SELECTION' },
        ],
      },
    },
  },
} as unknown as FrozenLiveBidPolicy;

function queueState(): AudienceQueueState {
  return {
    currentBidderId: 1,
    currentPhase: 'position_bid',
    queueCursor: 0,
    aDay: null,
    bidOrder: [1, 2, 3, 1, 2].map((memberId, ordinal) => ({ memberId, ordinal, pool: 'FF' })),
    fills: {},
    live: { dispositions: [] },
  };
}

describe('audience remaining turns', () => {
  it.each(['A601', 'B213', 'C203'])(
    'retains an early specialty award until its A-Day is picked: %s',
    (positionId) => {
      const state = queueState();
      state.fills = { [positionId]: { memberId: 2, ordinal: 2, bidId: 'early-award' } };
      expect(remainingAudienceQueue(state, policy)).toEqual([
        { memberId: 1, pendingADay: false },
        { memberId: 2, pendingADay: true },
        { memberId: 3, pendingADay: false },
      ]);
      state.fills[positionId] = { memberId: 2, ordinal: 2, bidId: 'early-award', aDay: 'G2' };
      expect(remainingAudienceQueue(state, policy).map((entry) => entry.memberId)).toEqual([1, 3]);
    },
  );

  it('does not repeat Days participants or completed members across stages', () => {
    const state = queueState();
    state.currentBidderId = 3;
    state.queueCursor = 2;
    state.fills = {
      D101: { memberId: 1, ordinal: 1, bidId: 'days', aDay: 'MON' },
      A101: { memberId: 2, ordinal: 2, bidId: 'regular', aDay: 'G1' },
    };
    expect(remainingAudienceQueue(state, policy)).toEqual([{ memberId: 3, pendingADay: false }]);
  });

  it('withdraws a Chief-directed member and restores their turn when the assignment is released', () => {
    const state = queueState();
    const assignment = {
      assignmentId: 'acting',
      commandId: 'chief-command',
      memberId: 2,
      roleLabel: 'Acting Division Chief of Prevention',
      positionId: null,
      actorMemberId: 99,
      reason: 'Authorized rehearsal',
      assignedAtMs: 1,
      releasedAtMs: null,
      releaseCommandId: null,
    };
    state.live = { dispositions: [], exceptionalAssignments: [assignment] };
    expect(remainingAudienceQueue(state, policy).map((entry) => entry.memberId)).toEqual([1, 3]);
    state.live = {
      dispositions: [],
      exceptionalAssignments: [{ ...assignment, releasedAtMs: 2, releaseCommandId: 'release' }],
    };
    expect(remainingAudienceQueue(state, policy).map((entry) => entry.memberId)).toEqual([1, 2, 3]);
  });
});

describe('audience current seat from reviewed effective staffing', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.exec(`INSERT INTO members
      (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
      VALUES (1,'synthetic-1','Synthetic','Bidder','FF','FF',1,0,1,1),(2,'synthetic-2','Synthetic','Successor','FF','FF',2,0,1,1);
      INSERT INTO staffing_positions
      (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
      VALUES ('seat','SYNTHETIC/SEAT','A','1','Engine 1','Firefighter','FF','2026-01-01','approved',1,1);
      INSERT INTO member_assignments
      (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,created_at,updated_at)
      VALUES ('assignment',1,'seat','CORRECTION','synthetic reviewed correction','planned','2026-09-01',1,1);`);
  });
  afterEach(async () => teardownTestD1(h));

  it('matches the effective roster even when the effective assignment retains planned status', async () => {
    expect(await loadAudienceCurrentAssignment(h.env.DB, 1, '2026-10-03')).toEqual({
      position_id: 'seat',
      position_name: 'Firefighter',
      shift: 'A',
      station: '1',
      unit: 'Engine 1',
    });
  });

  it('omits future, cancelled and unreviewed seats without falling back to a previous bid', async () => {
    expect(await loadAudienceCurrentAssignment(h.env.DB, 1, '2026-08-31')).toBeNull();
    h.sqlite.exec(
      "UPDATE member_assignments SET status='cancelled'; UPDATE staffing_positions SET review_status='draft'",
    );
    expect(await loadAudienceCurrentAssignment(h.env.DB, 1, '2026-10-03')).toBeNull();
  });

  it('does not show a superseded incumbent after an effective replacement', async () => {
    h.sqlite.exec(`UPDATE member_assignments SET status='superseded',effective_to='2026-09-30';
      INSERT INTO member_assignments
      (id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,created_at,updated_at)
      VALUES ('replacement',2,'seat','CORRECTION','synthetic successor','active','2026-10-01',2,2);`);
    expect(await loadAudienceCurrentAssignment(h.env.DB, 1, '2026-10-03')).toBeNull();
    expect(await loadAudienceCurrentAssignment(h.env.DB, 2, '2026-10-03')).toMatchObject({
      position_id: 'seat',
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  BidSessionSpecialtyAdapter,
  type SpecialtyDOStorageLike,
  bidSessionSpecialtyStorageKey,
  loadBidSessionSpecialtyState,
} from '../../src/durable/bid-session-specialty.js';
import type {
  SpecialtyAdjudicationPolicy,
  SpecialtyAdjudicationRequest,
} from '../../src/lib/specialty-adjudication.js';
import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';

const SESSION_ID = 'specialty-session-1';
const normalTurn = {
  turnId: 'normal-turn-17',
  bidderId: 17,
  ordinal: 42,
  queueCursor: 41,
} as const;

const eligible = { status: 'eligible' } as const;

function policy(): SpecialtyAdjudicationPolicy {
  return {
    policyReference: 'synthetic-marine-v1',
    source: 'synthetic',
    testPolicy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: 'synthetic-marine-v1',
      specialty_pool: { id: 'MARINE_TEST_POOL', label: 'Marine Operations synthetic test pool' },
      qualification_requirements: ['Marine Operations'],
      ranking: {
        source: 'EXPLICIT_TEST_PRIORITY',
        reference: 'synthetic-marine-priority-v1',
      },
      tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'],
      normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
      candidate_outcomes: ['award', 'declined', 'unavailable'],
      original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN',
    },
    candidateReleasePolicy: {
      status: 'configured',
      onRelease: 'continue_to_next_higher_priority',
    },
    candidates: [
      {
        memberId: 17,
        priorityRank: 2,
        generalEligibility: eligible,
        specialtyEligibility: eligible,
      },
      {
        memberId: 11,
        priorityRank: 1,
        generalEligibility: eligible,
        specialtyEligibility: eligible,
      },
    ],
  };
}

function request(commandId = 'begin-1'): SpecialtyAdjudicationRequest {
  return {
    commandId,
    expectedRevision: 0,
    requestId: 'specialty-request-1',
    positionId: 'B601-MARINE-OPERATOR',
    normalTurn,
    policy: policy(),
  };
}

class MemoryStorage implements SpecialtyDOStorageLike {
  readonly values = new Map<string, unknown>();
  readonly writes: Array<{ key: string; value: unknown }> = [];

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    const copy = JSON.parse(JSON.stringify(value)) as unknown;
    this.writes.push({ key, value: copy });
    this.values.set(key, copy);
  }
}

describe('BidSessionSpecialtyAdapter', () => {
  it('uses a session-scoped storage key and defaults missing durable state safely', async () => {
    const storage = new MemoryStorage();

    expect(bidSessionSpecialtyStorageKey(SESSION_ID)).toBe(
      'bs:specialty-session-1:specialty-adjudication',
    );
    await expect(loadBidSessionSpecialtyState(storage, SESSION_ID)).resolves.toEqual({
      version: 1,
      revision: 0,
      active: null,
      consumedCommandIds: [],
      processedRequestIds: [],
      resumedRequestIds: [],
    });
    expect(storage.writes).toEqual([]);
  });

  it('fails closed on a present corrupt snapshot instead of replacing an interruption with a default state', async () => {
    const storage = new MemoryStorage();
    storage.values.set(bidSessionSpecialtyStorageKey(SESSION_ID), { version: 99 });
    const adapter = new BidSessionSpecialtyAdapter(storage, SESSION_ID);

    const result = await adapter.begin(request());

    expect(result).toMatchObject({ kind: 'rejected', code: 'INVALID_STATE' });
    expect(storage.writes).toEqual([]);
  });

  it('serializes a concurrent begin then candidate command, persists each accepted transition, and returns engine audit events', async () => {
    const storage = new MemoryStorage();
    const adapter = new BidSessionSpecialtyAdapter(storage, SESSION_ID);

    const begin = adapter.begin(request());
    const candidate = adapter.resolveCandidate({
      commandId: 'candidate-11-award',
      expectedRevision: 1,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'award', awardReference: 'award-11' },
    });
    const [started, resolved] = await Promise.all([begin, candidate]);

    expect(started.kind).toBe('suspended');
    expect(resolved.kind).toBe('candidate_resolved');
    if (resolved.kind !== 'candidate_resolved') return;
    expect(resolved.state.active).toMatchObject({ phase: 'awaiting_resume' });
    expect(resolved.events.map((event) => event.type)).toEqual([
      'specialty_candidate_resolved',
      'specialty_position_awarded',
    ]);
    expect(storage.writes).toHaveLength(2);
    expect(storage.writes.map((write) => write.key)).toEqual([
      bidSessionSpecialtyStorageKey(SESSION_ID),
      bidSessionSpecialtyStorageKey(SESSION_ID),
    ]);
  });

  it('restores the persisted interruption through a new adapter instance', async () => {
    const storage = new MemoryStorage();
    const firstConnection = new BidSessionSpecialtyAdapter(storage, SESSION_ID);
    const started = await firstConnection.begin(request());
    expect(started.kind).toBe('suspended');

    const reconnected = new BidSessionSpecialtyAdapter(storage, SESSION_ID);
    const recovered = await reconnected.load();
    expect(recovered).toEqual(started.state);

    const resolved = await reconnected.resolveCandidate({
      commandId: 'candidate-11-release',
      expectedRevision: 1,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(resolved.kind).toBe('candidate_resolved');
    if (resolved.kind !== 'candidate_resolved') return;
    expect(resolved.state.active).toMatchObject({ phase: 'awaiting_original_bidder' });
  });

  it('does not write durable state for stale, out-of-order, or duplicate commands', async () => {
    const storage = new MemoryStorage();
    const adapter = new BidSessionSpecialtyAdapter(storage, SESSION_ID);
    await adapter.begin(request());
    const writesAfterBegin = storage.writes.length;

    const stale = await adapter.resolveCandidate({
      commandId: 'candidate-stale',
      expectedRevision: 0,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(stale).toMatchObject({ kind: 'rejected', code: 'STALE_REVISION' });
    expect(storage.writes).toHaveLength(writesAfterBegin);

    const outOfOrder = await adapter.resolveCandidate({
      commandId: 'candidate-wrong',
      expectedRevision: 1,
      requestId: 'specialty-request-1',
      memberId: 17,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(outOfOrder).toMatchObject({ kind: 'rejected', code: 'OUT_OF_ORDER_CANDIDATE' });
    expect(storage.writes).toHaveLength(writesAfterBegin);

    const accepted = await adapter.resolveCandidate({
      commandId: 'candidate-11-award',
      expectedRevision: 1,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'award', awardReference: 'award-11' },
    });
    expect(accepted.kind).toBe('candidate_resolved');
    const writesAfterAccepted = storage.writes.length;

    const duplicate = await adapter.resolveCandidate({
      commandId: 'candidate-11-award',
      expectedRevision: 1,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'award', awardReference: 'award-11' },
    });
    expect(duplicate).toMatchObject({ kind: 'rejected', code: 'DUPLICATE_COMMAND' });
    expect(storage.writes).toHaveLength(writesAfterAccepted);
  });

  it('persists original resolution and returns the exact normal turn only once across reconnect', async () => {
    const storage = new MemoryStorage();
    const adapter = new BidSessionSpecialtyAdapter(storage, SESSION_ID);
    await adapter.begin(request());
    const released = await adapter.resolveCandidate({
      commandId: 'candidate-11-release',
      expectedRevision: 1,
      requestId: 'specialty-request-1',
      memberId: 11,
      outcome: { kind: 'release', reason: 'declined' },
    });
    expect(released.kind).toBe('candidate_resolved');

    const original = await adapter.resolveOriginal({
      commandId: 'original-award',
      expectedRevision: 2,
      requestId: 'specialty-request-1',
      outcome: { kind: 'award', awardReference: 'award-17' },
    });
    expect(original.kind).toBe('original_resolved');

    const resumed = await adapter.resume({
      commandId: 'resume-1',
      expectedRevision: 3,
      requestId: 'specialty-request-1',
    });
    expect(resumed).toMatchObject({ kind: 'resumed', normalTurn });

    const writesAfterResume = storage.writes.length;
    const reconnected = new BidSessionSpecialtyAdapter(storage, SESSION_ID);
    const repeated = await reconnected.resume({
      commandId: 'resume-2',
      expectedRevision: 4,
      requestId: 'specialty-request-1',
    });
    expect(repeated).toMatchObject({ kind: 'rejected', code: 'ALREADY_RESUMED' });
    expect(storage.writes).toHaveLength(writesAfterResume);
  });
});

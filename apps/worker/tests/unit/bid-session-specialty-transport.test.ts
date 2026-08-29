import { describe, expect, it } from 'vitest';

import {
  bidSessionSpecialtyReceiptStorageKey,
  specialtyCommandReceiptFingerprint,
} from '../../src/durable/bid-session-specialty.js';
import {
  type BidSessionState,
  bidSessionStateStorageKey,
} from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';
import type { WorkerEnv } from '../../src/types/env.js';

const SESSION_ID = '01HZZ0000000000000SPECIALTYDO';

class MemoryDurableStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string | Record<string, T>, value?: T): Promise<void> {
    if (typeof key === 'string') {
      this.values.set(key, value);
      return;
    }
    for (const [entryKey, entryValue] of Object.entries(key)) this.values.set(entryKey, entryValue);
  }

  async list<T>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    return new Map(
      [...this.values.entries()].filter(
        ([key]) => options.prefix === undefined || key.startsWith(options.prefix),
      ),
    ) as Map<string, T>;
  }

  async transaction<T>(closure: (transaction: MemoryDurableStorage) => Promise<T>): Promise<T> {
    return closure(this);
  }
}

function initialNormalState(): BidSessionState {
  return {
    bidSessionId: SESSION_ID,
    currentPhase: 'position_bid',
    currentBidderId: 17,
    turnStartedAtMs: 50,
    turnTimerSeconds: 180,
    lastSeq: 8,
    fills: {},
    bidOrder: [{ ordinal: 42, memberId: 17, pool: 'FF' }],
    queueCursor: 0,
    frozenAt: null,
    aDay: null,
  };
}

function fakeState(storage: MemoryDurableStorage): DurableObjectState {
  return {
    id: { name: SESSION_ID, toString: () => SESSION_ID } as DurableObjectId,
    storage: storage as unknown as DurableObjectStorage,
    blockConcurrencyWhile: async <T>(closure: () => Promise<T>) => closure(),
    waitUntil: () => undefined,
  } as unknown as DurableObjectState;
}

function syntheticPolicy() {
  return {
    policyReference: 'synthetic-specialty-fixture-v1',
    source: 'synthetic' as const,
    testPolicy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: 'synthetic-specialty-fixture-v1',
      specialty_pool: { id: 'MARINE_TEST_POOL', label: 'Marine Operations synthetic test pool' },
      qualification_requirements: ['Marine Operations'],
      ranking: {
        source: 'EXPLICIT_TEST_PRIORITY' as const,
        reference: 'synthetic-marine-priority-v1',
      },
      scoring: {
        source: 'EXPLICIT_TEST_PRIORITY' as const,
        direction: 'LOWER_SCORE_WINS' as const,
      },
      tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'] as const,
      normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN' as const,
      candidate_outcomes: ['award', 'declined', 'unreachable'] as const,
      original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN' as const,
    },
    candidateReleasePolicy: {
      status: 'configured' as const,
      onRelease: 'continue_to_next_higher_priority' as const,
    },
    candidates: [
      {
        memberId: 11,
        priorityRank: 1,
        generalEligibility: { status: 'eligible' as const },
        specialtyEligibility: { status: 'eligible' as const },
      },
      {
        memberId: 17,
        priorityRank: 2,
        generalEligibility: { status: 'eligible' as const },
        specialtyEligibility: { status: 'eligible' as const },
      },
    ],
  };
}

function audit(reason: string) {
  return {
    actorId: 0,
    reason,
    origin: 'synthetic_specialty_test' as const,
    effectiveDate: null,
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function reverseObjectKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reverseObjectKeyOrder(entry)]),
  );
}

describe('BidSessionDO synthetic specialty transport', () => {
  it('uses deterministic canonical payload ordering for specialty receipt fingerprints', () => {
    const payload = {
      command: {
        commandId: 'specialty-canonical-fingerprint-1',
        expectedRevision: 0,
        requestId: 'specialty-canonical-request-1',
        positionId: 'A101',
        policy: syntheticPolicy(),
      },
      audit: audit('Synthetic specialty canonicalization rehearsal.'),
    };
    expect(specialtyCommandReceiptFingerprint('begin', payload)).toBe(
      specialtyCommandReceiptFingerprint('begin', reverseObjectKeyOrder(payload)),
    );
  });

  it('atomically persists a revisioned synthetic interruption receipt and returns the exact normal turn after reconnect', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), initialNormalState());
    const subject = new BidSessionDO(fakeState(storage), {} as WorkerEnv);
    const beginPayload = {
      command: {
        commandId: 'specialty-begin-1',
        expectedRevision: 0,
        requestId: 'specialty-request-1',
        positionId: 'A101',
        policy: syntheticPolicy(),
      },
      audit: audit('Synthetic specialty interruption rehearsal.'),
    };

    const begin = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(beginPayload),
      }),
    );
    expect(begin.status).toBe(200);
    await expect(json(begin)).resolves.toMatchObject({
      mode: 'synthetic_test_only',
      does_not_commit_bid: true,
      kind: 'accepted',
      idempotent_replay: false,
      result: {
        kind: 'suspended',
        state: {
          revision: 1,
          active: {
            originalTurn: {
              turnId: `normal:${SESSION_ID}:8:42:0:17`,
              bidderId: 17,
              ordinal: 42,
              queueCursor: 0,
            },
          },
        },
      },
      audit_receipt: {
        actorType: 'admin',
        actorId: 0,
        origin: 'synthetic_specialty_test',
        effectiveDate: null,
        beforeState: { revision: 0 },
        afterState: { revision: 1 },
      },
    });

    const duplicate = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(beginPayload),
      }),
    );
    expect(duplicate.status).toBe(200);
    await expect(json(duplicate)).resolves.toMatchObject({
      kind: 'accepted',
      idempotent_replay: true,
      result: { kind: 'suspended', state: { revision: 1 } },
    });

    // A fresh DO instance represents reconnect/eviction. It sees the durable
    // interruption state and receipt rather than re-evaluating the policy.
    const reconnected = new BidSessionDO(fakeState(storage), {} as WorkerEnv);
    const status = await reconnected.fetch(new Request('https://do/admin/specialty-adjudication'));
    expect(status.status).toBe(200);
    await expect(json(status)).resolves.toMatchObject({
      mode: 'synthetic_test_only',
      database_audit_log: 'not_written',
      state: { revision: 1, active: { candidateCursor: 0 } },
      audit_receipts: [
        {
          commandId: 'specialty-begin-1',
          actorId: 0,
          reason: 'Synthetic specialty interruption rehearsal.',
        },
      ],
    });

    const candidate = await reconnected.fetch(
      new Request('https://do/admin/specialty-adjudication/resolve-candidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command: {
            commandId: 'specialty-candidate-award-1',
            expectedRevision: 1,
            requestId: 'specialty-request-1',
            memberId: 11,
            outcome: { kind: 'award', awardReference: 'synthetic-award-11' },
          },
          audit: audit('Synthetic higher-priority candidate accepted.'),
        }),
      }),
    );
    expect(candidate.status).toBe(200);
    await expect(json(candidate)).resolves.toMatchObject({
      kind: 'accepted',
      result: {
        kind: 'candidate_resolved',
        state: { revision: 2, active: { phase: 'awaiting_resume' } },
      },
    });

    const resumed = await reconnected.fetch(
      new Request('https://do/admin/specialty-adjudication/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command: {
            commandId: 'specialty-resume-1',
            expectedRevision: 2,
            requestId: 'specialty-request-1',
          },
          audit: audit('Synthetic specialty interruption complete.'),
        }),
      }),
    );
    expect(resumed.status).toBe(200);
    await expect(json(resumed)).resolves.toMatchObject({
      kind: 'accepted',
      result: {
        kind: 'resumed',
        normalTurn: {
          turnId: `normal:${SESSION_ID}:8:42:0:17`,
          bidderId: 17,
          ordinal: 42,
          queueCursor: 0,
        },
        state: { revision: 3, active: null },
      },
      audit_receipt: {
        beforeState: { revision: 2 },
        afterState: { revision: 3, active: null },
      },
    });

    const finalStatus = await new BidSessionDO(fakeState(storage), {} as WorkerEnv).fetch(
      new Request('https://do/admin/specialty-adjudication'),
    );
    await expect(json(finalStatus)).resolves.toMatchObject({
      state: { revision: 3, active: null },
      audit_receipts: [
        { commandId: 'specialty-begin-1' },
        { commandId: 'specialty-candidate-award-1' },
        { commandId: 'specialty-resume-1' },
      ],
    });
  });

  it('replays only an identical specialty operation, command payload, and audit record', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), initialNormalState());
    const subject = new BidSessionDO(fakeState(storage), {} as WorkerEnv);
    const beginPayload = {
      command: {
        commandId: 'specialty-fingerprint-payload-1',
        expectedRevision: 0,
        requestId: 'specialty-fingerprint-request-1',
        positionId: 'A101',
        policy: syntheticPolicy(),
      },
      audit: audit('Synthetic specialty fingerprint rehearsal.'),
    };

    const accepted = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(beginPayload),
      }),
    );
    expect(accepted.status).toBe(200);

    const exactReplay = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(beginPayload),
      }),
    );
    expect(exactReplay.status).toBe(200);
    await expect(json(exactReplay)).resolves.toMatchObject({
      kind: 'accepted',
      idempotent_replay: true,
    });

    const changedPayload = {
      command: {
        ...beginPayload.command,
        positionId: 'A102',
      },
      audit: audit('A materially different synthetic specialty rehearsal.'),
    };
    const mismatch = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changedPayload),
      }),
    );
    expect(mismatch.status).toBe(409);
    await expect(json(mismatch)).resolves.toMatchObject({
      kind: 'rejected',
      error: 'SPECIALTY_COMMAND_ID_REUSE_CONFLICT',
      result: null,
    });

    const afterMismatch = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication'),
    );
    await expect(json(afterMismatch)).resolves.toMatchObject({
      state: { revision: 1 },
      audit_receipts: [{ commandId: beginPayload.command.commandId }],
    });
  });

  it('rejects cross-operation specialty command ID reuse without mutating state', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), initialNormalState());
    const subject = new BidSessionDO(fakeState(storage), {} as WorkerEnv);
    const commandId = 'specialty-fingerprint-cross-operation-1';
    const beginPayload = {
      command: {
        commandId,
        expectedRevision: 0,
        requestId: 'specialty-fingerprint-cross-operation-request-1',
        positionId: 'A101',
        policy: syntheticPolicy(),
      },
      audit: audit('Synthetic specialty cross-operation rehearsal.'),
    };
    const begin = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(beginPayload),
      }),
    );
    expect(begin.status).toBe(200);

    const crossOperation = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication/resolve-candidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command: {
            commandId,
            expectedRevision: 1,
            requestId: beginPayload.command.requestId,
            memberId: 11,
            outcome: { kind: 'award', awardReference: 'synthetic-cross-operation-award' },
          },
          audit: audit('Attempted cross-operation command ID reuse.'),
        }),
      }),
    );
    expect(crossOperation.status).toBe(409);
    await expect(json(crossOperation)).resolves.toMatchObject({
      kind: 'rejected',
      error: 'SPECIALTY_COMMAND_ID_REUSE_CONFLICT',
      result: null,
    });

    const afterMismatch = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication'),
    );
    await expect(json(afterMismatch)).resolves.toMatchObject({
      state: { revision: 1, active: { phase: 'resolving_higher_priority_candidates' } },
      audit_receipts: [{ commandId }],
    });
  });

  it('fails closed for a historical specialty receipt without a fingerprint', async () => {
    const storage = new MemoryDurableStorage();
    await storage.put(bidSessionStateStorageKey(SESSION_ID), initialNormalState());
    const commandId = 'specialty-historical-receipt-1';
    await storage.put(bidSessionSpecialtyReceiptStorageKey(SESSION_ID, commandId), {
      version: 1,
      commandId,
      operation: 'begin',
    });
    const subject = new BidSessionDO(fakeState(storage), {} as WorkerEnv);
    const rejected = await subject.fetch(
      new Request('https://do/admin/specialty-adjudication/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command: {
            commandId,
            expectedRevision: 0,
            requestId: 'specialty-historical-request-1',
            positionId: 'A101',
            policy: syntheticPolicy(),
          },
          audit: audit('Historical specialty receipt must not replay.'),
        }),
      }),
    );
    expect(rejected.status).toBe(409);
    await expect(json(rejected)).resolves.toMatchObject({
      kind: 'rejected',
      error: 'SPECIALTY_COMMAND_ID_REUSE_CONFLICT',
      result: null,
    });
    await expect(
      storage.get<BidSessionState>(bidSessionStateStorageKey(SESSION_ID)),
    ).resolves.toEqual(initialNormalState());
  });
});

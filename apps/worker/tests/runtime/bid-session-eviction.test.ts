import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';

const SESSION_NAME = '01HZZ0000000000000EVICTIONDO';

async function seedMockNormalTurn(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO bid_years (year, status) VALUES (2026, 'configuring')"),
    env.DB.prepare(
      `INSERT INTO members
        (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
         rank_seniority, is_probationary, created_at, updated_at)
       VALUES (17, 'SYNTH-17', 'Synthetic', 'Bidder', 'FF', 'FF', 1, 1, 0, 1787918400000, 1787918400000)
       ON CONFLICT(id) DO NOTHING`,
    ),
    env.DB.prepare(
      `INSERT INTO bid_sessions
          (id, bid_year, started_at, current_phase, current_bidder_id, turn_timer_seconds,
           expected_duration_days, day_count, is_mock, mock_control_revision)
         VALUES (?, 2026, 1787918400000, 'position_bid', 17, 180, 2, 0, 1, 0)`,
    ).bind(SESSION_NAME),
    env.DB.prepare(
      "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 42, 17, 'FF')",
    ).bind(SESSION_NAME),
  ]);
}

function policy() {
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

describe('BidSessionDO eviction reconstruction', () => {
  it('evicts the actual named binding instance and reconstructs the durable specialty interruption', async () => {
    await seedMockNormalTurn();
    const id = env.BID_SESSION.idFromName(SESSION_NAME);
    const stub = env.BID_SESSION.get(id);

    await (await stub.fetch('https://do/snapshot')).json();
    let evictedInstance: unknown;
    await runInDurableObject(stub, async (instance) => {
      const subject = instance as unknown as { evictionSentinel?: string };
      subject.evictionSentinel = 'memory-only-before-eviction';
      evictedInstance = instance;
    });

    const begin = await stub.fetch('https://do/admin/specialty-adjudication/begin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: {
          commandId: 'eviction-specialty-begin-1',
          expectedRevision: 0,
          expectedNormalControlRevision: 0,
          requestId: 'eviction-specialty-request-1',
          positionId: 'A101',
          policy: policy(),
        },
        audit: {
          actorId: 0,
          reason: 'Runtime eviction rehearsal.',
          origin: 'synthetic_specialty_test',
          effectiveDate: null,
        },
      }),
    });
    const beginBody = (await begin.json()) as Record<string, unknown>;
    expect(begin.status).toBe(200);
    expect(beginBody).toMatchObject({ kind: 'accepted' });

    const beforeEviction = await (await stub.fetch('https://do/admin/specialty-adjudication')).json<
      Record<string, unknown>
    >();

    await evictDurableObject(stub);

    const reconstructed = await (await stub.fetch('https://do/admin/specialty-adjudication')).json<
      Record<string, unknown>
    >();
    expect(reconstructed).toMatchObject({
      normal_turn: { bidder_id: 17, ordinal: 42, queue_cursor: 0 },
      state: {
        revision: 1,
        active: { originalTurn: { bidderId: 17, ordinal: 42, queueCursor: 0 }, candidateCursor: 0 },
      },
      audit_receipts: [{ commandId: 'eviction-specialty-begin-1' }],
    });
    expect(reconstructed).toEqual(beforeEviction);

    await runInDurableObject(stub, async (instance) => {
      const subject = instance as unknown as { evictionSentinel?: string };
      expect(instance).not.toBe(evictedInstance);
      expect(subject.evictionSentinel).toBeUndefined();
    });

    const replay = await stub.fetch('https://do/admin/specialty-adjudication/begin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: {
          commandId: 'eviction-specialty-begin-1',
          expectedRevision: 0,
          expectedNormalControlRevision: 0,
          requestId: 'eviction-specialty-request-1',
          positionId: 'A101',
          policy: policy(),
        },
        audit: {
          actorId: 0,
          reason: 'Runtime eviction rehearsal.',
          origin: 'synthetic_specialty_test',
          effectiveDate: null,
        },
      }),
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      idempotent_replay: true,
      result: { state: { revision: 1 } },
    });

    const candidate = await stub.fetch(
      'https://do/admin/specialty-adjudication/resolve-candidate',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command: {
            commandId: 'eviction-specialty-candidate-1',
            expectedRevision: 1,
            requestId: 'eviction-specialty-request-1',
            memberId: 11,
            outcome: { kind: 'award', awardReference: 'synthetic-award-11' },
          },
          audit: {
            actorId: 0,
            reason: 'Higher-priority synthetic award.',
            origin: 'synthetic_specialty_test',
            effectiveDate: null,
          },
        }),
      },
    );
    expect(candidate.status).toBe(200);
    expect(await candidate.json()).toMatchObject({
      result: {
        kind: 'candidate_resolved',
        state: { revision: 2, active: { phase: 'awaiting_resume' } },
      },
    });

    const afterResolution = await (
      await stub.fetch('https://do/admin/specialty-adjudication')
    ).json<Record<string, unknown>>();
    await evictDurableObject(stub);
    const reconstructedResolution = await (
      await stub.fetch('https://do/admin/specialty-adjudication')
    ).json<Record<string, unknown>>();
    expect(reconstructedResolution).toEqual(afterResolution);

    const resumed = await stub.fetch('https://do/admin/specialty-adjudication/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: {
          commandId: 'eviction-specialty-resume-1',
          expectedRevision: 2,
          requestId: 'eviction-specialty-request-1',
        },
        audit: {
          actorId: 0,
          reason: 'Resume exact original normal turn.',
          origin: 'synthetic_specialty_test',
          effectiveDate: null,
        },
      }),
    });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({
      result: {
        kind: 'resumed',
        normalTurn: { bidderId: 17, ordinal: 42, queueCursor: 0 },
        state: { revision: 3, active: null, resumedRequestIds: ['eviction-specialty-request-1'] },
      },
    });

    const duplicateResume = await stub.fetch('https://do/admin/specialty-adjudication/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: {
          commandId: 'eviction-specialty-resume-2',
          expectedRevision: 3,
          requestId: 'eviction-specialty-request-1',
        },
        audit: {
          actorId: 0,
          reason: 'Must never resume twice.',
          origin: 'synthetic_specialty_test',
          effectiveDate: null,
        },
      }),
    });
    expect(duplicateResume.status).toBe(409);
    expect(await duplicateResume.json()).toMatchObject({ error: 'ALREADY_RESUMED' });
    const normal = await env.DB.prepare(
      'SELECT current_bidder_id, mock_control_revision FROM bid_sessions WHERE id = ?',
    )
      .bind(SESSION_NAME)
      .first();
    expect(normal).toEqual({ current_bidder_id: 17, mock_control_revision: 0 });
  });
});

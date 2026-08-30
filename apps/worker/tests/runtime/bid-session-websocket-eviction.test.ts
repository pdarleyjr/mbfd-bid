import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { WEBSOCKET_TICKET_AUDIENCE } from '@mbfd/shared';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';

const SESSION_NAME = '01HZZ0000000000000EVICTIONWS';
const SERIALIZATION_SESSION_NAME = '01HZZ0000000000000WSSERIAL';
const ORIGIN = 'https://staging.bid.mbfdhub.com';
const worker = exports as unknown as { default: Fetcher };

async function seedMockNormalTurn(sessionName = SESSION_NAME): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO bid_years (year, status) VALUES (2026, 'configuring')"),
    env.DB.prepare(
      `INSERT INTO members
        (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
         rank_seniority, is_probationary, created_at, updated_at)
       VALUES (17, 'SYNTH-WS-17', 'Synthetic', 'Socket', 'FF', 'FF', 1, 1, 0, 1787918400000, 1787918400000)
       ON CONFLICT(id) DO NOTHING`,
    ),
    env.DB.prepare(
      `INSERT INTO bid_sessions
          (id, bid_year, started_at, current_phase, current_bidder_id, turn_timer_seconds,
           expected_duration_days, day_count, is_mock, mock_control_revision)
         VALUES (?, 2026, 1787918400000, 'position_bid', 17, 180, 2, 0, 1, 0)`,
    ).bind(sessionName),
    env.DB.prepare(
      "INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool) VALUES (?, 42, 17, 'FF')",
    ).bind(sessionName),
  ]);
}

function policy() {
  return {
    policyReference: 'synthetic-websocket-serialization-fixture-v1',
    source: 'synthetic' as const,
    testPolicy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: 'synthetic-websocket-serialization-fixture-v1',
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

async function ticket(sessionName = SESSION_NAME): Promise<string> {
  return new SignJWT({ sub: '17', role: 'admin', session_id: sessionName })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(WEBSOCKET_TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(new TextEncoder().encode(env.JWT_SIGNING_KEY));
}

function waitFor(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}.`)), 5_000);
    socket.addEventListener('message', (event) => {
      const value = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (value.type !== type) return;
      clearTimeout(timer);
      resolve(value);
    });
  });
}

async function connectFresh(): Promise<{
  socket: WebSocket;
  snapshot: Record<string, unknown>;
  specialty: Record<string, unknown>;
}> {
  const freshTicket = await ticket();
  const response = await worker.default.fetch(
    new Request(`${ORIGIN}/api/ws/session/${SESSION_NAME}`, {
      headers: {
        Origin: ORIGIN,
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': `mbfd-bid-v1, ${freshTicket}`,
      },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error('Expected authenticated WebSocket upgrade.');
  socket.accept();
  const snapshotPromise = waitFor(socket, 'state_snapshot');
  const specialtyPromise = waitFor(socket, 'synthetic_specialty_state_changed');
  socket.send(JSON.stringify({ type: 'hello', lastSeq: 0 }));
  return { socket, snapshot: await snapshotPromise, specialty: await specialtyPromise };
}

function collectMessages(
  socket: WebSocket,
  type: string,
  count: number,
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const values: Record<string, unknown>[] = [];
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${count} ${type} messages.`)),
      5_000,
    );
    socket.addEventListener('message', (event) => {
      const value = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (value.type !== type) return;
      values.push(value);
      if (values.length === count) {
        clearTimeout(timer);
        resolve(values);
      }
    });
  });
}

async function connectFor(sessionName: string): Promise<WebSocket> {
  const freshTicket = await ticket(sessionName);
  const response = await worker.default.fetch(
    new Request(`${ORIGIN}/api/ws/session/${sessionName}`, {
      headers: {
        Origin: ORIGIN,
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': `mbfd-bid-v1, ${freshTicket}`,
      },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) throw new Error('Expected authenticated WebSocket upgrade.');
  socket.accept();
  const snapshot = waitFor(socket, 'state_snapshot');
  socket.send(JSON.stringify({ type: 'hello', lastSeq: 0 }));
  await snapshot;
  return socket;
}

describe('BidSessionDO standard WebSocket reconnect after eviction', () => {
  it('requires a fresh ticket and reconnects to the reconstructed named session', async () => {
    await seedMockNormalTurn();
    const id = env.BID_SESSION.idFromName(SESSION_NAME);
    const stub = env.BID_SESSION.get(id);
    const first = await connectFresh();
    expect(first.snapshot).toMatchObject({
      payload: { currentBidderId: null, currentPhase: 'config' },
    });
    expect(first.specialty).toMatchObject({
      bidSessionId: SESSION_NAME,
      controlState: {
        rehearsalRevision: 0,
        normalTurn: { bidderId: 17, ordinal: 42, queueCursor: 0, mockControlRevision: 0 },
        normalBidderSuspended: false,
      },
    });

    const closed = new Promise<void>((resolve) =>
      first.socket.addEventListener('close', () => resolve()),
    );
    first.socket.close(1000, 'test disconnect');
    await closed;
    await evictDurableObject(stub);

    const second = await connectFresh();
    expect(second.snapshot).toMatchObject({ payload: first.snapshot.payload });
    expect(second.specialty).toMatchObject(first.specialty);
    second.socket.close(1000, 'test complete');
  });

  it('serializes concurrent paused picks and contains an asynchronous handler rejection', async () => {
    await seedMockNormalTurn(SERIALIZATION_SESSION_NAME);
    const id = env.BID_SESSION.idFromName(SERIALIZATION_SESSION_NAME);
    const stub = env.BID_SESSION.get(id);
    const socket = await connectFor(SERIALIZATION_SESSION_NAME);

    const begin = await stub.fetch(
      new Request('https://do/admin/specialty-adjudication/begin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command: {
            commandId: 'ws-serialization-begin-1',
            expectedRevision: 0,
            expectedNormalControlRevision: 0,
            requestId: 'ws-serialization-request-1',
            positionId: 'A101',
            policy: policy(),
          },
          audit: {
            actorId: 0,
            reason: 'Prove websocket mutation serialization while the normal turn is paused.',
            origin: 'synthetic_specialty_test',
            effectiveDate: null,
          },
        }),
      }),
    );
    expect(begin.status).toBe(200);

    const rejects = collectMessages(socket, 'pick_rejected', 2);
    socket.send(
      JSON.stringify({
        type: 'submit_pick',
        positionId: 'A101',
        aDay: null,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      }),
    );
    socket.send(
      JSON.stringify({
        type: 'submit_pick',
        positionId: 'A101',
        aDay: null,
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      }),
    );
    await expect(rejects).resolves.toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ code: 'SESSION_PAUSED' }) }),
      expect.objectContaining({ payload: expect.objectContaining({ code: 'SESSION_PAUSED' }) }),
    ]);

    const beforeRejectedHandler = await stub.fetch('https://do/admin/specialty-adjudication');
    expect(await beforeRejectedHandler.json()).toMatchObject({ state: { revision: 1 } });

    await runInDurableObject(stub, (instance) => {
      (instance as unknown as { onMessage: () => Promise<void> }).onMessage = async () => {
        throw new Error('controlled websocket handler rejection');
      };
    });

    let unhandledRejection = false;
    const onUnhandledRejection = () => {
      unhandledRejection = true;
    };
    globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
    const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener('close', resolve));
    socket.send(JSON.stringify({ type: 'ping', ts: 1 }));
    const close = await closed;
    globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);

    expect(close.code).toBe(1011);
    expect(unhandledRejection).toBe(false);
    const afterRejectedHandler = await stub.fetch('https://do/admin/specialty-adjudication');
    expect(await afterRejectedHandler.json()).toMatchObject({ state: { revision: 1 } });
  });
});

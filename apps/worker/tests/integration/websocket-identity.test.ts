import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { BidSessionDO } from '../../src/durable/bid-session.js';
import { signJwt } from '../../src/lib/jwt.js';
import {
  parseVerifiedWebSocketIdentity,
  verifiedWebSocketIdentityHeaders,
} from '../../src/lib/websocket-identity.js';
import ws from '../../src/routes/ws.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

interface TestStorage {
  data: Map<string, unknown>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(prefix: string): Promise<Map<string, T>>;
}

function makeStorage(): TestStorage {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined;
    },
    async put<T>(key: string, value: T): Promise<void> {
      data.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return data.delete(key);
    },
    async list<T>(prefix: string): Promise<Map<string, T>> {
      return new Map([...data].filter(([key]) => key.startsWith(prefix)) as Array<[string, T]>);
    },
  };
}

function makeStateMock(id: string, storage: TestStorage): DurableObjectState {
  return {
    id: { toString: () => id, equals: () => false, name: id } as unknown as DurableObjectId,
    storage: storage as unknown as DurableObjectStorage,
    async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    waitUntil() {},
    acceptWebSocket() {},
    getWebSockets: () => [],
    setHibernatableWebSocketEventTimeout() {},
    getHibernatableWebSocketEventTimeout: () => null,
    setWebSocketAutoResponse() {},
    getWebSocketAutoResponse: () => null,
    getWebSocketAutoResponseTimestamp: () => null,
    abort() {},
  } as unknown as DurableObjectState;
}

describe('WebSocket identity handoff', () => {
  const sessionId = '01HZZ000000000000WSIDENT1';
  let h: TestD1;
  let storage: TestStorage;

  beforeEach(async () => {
    h = await setupTestD1();
    storage = makeStorage();
    const state: BidSessionState = {
      ...emptyBidSessionState(sessionId),
      currentPhase: 'position_bid',
      currentBidderId: 42,
      turnStartedAtMs: 1,
      bidOrder: [{ ordinal: 1, memberId: 42, pool: 'FF' }],
    };
    await storage.put(`bs:${sessionId}:state`, state);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('serializes verified claims and rejects malformed internal identity headers', () => {
    const headers = new Headers(verifiedWebSocketIdentityHeaders({ memberId: 42, role: 'member' }));
    expect(parseVerifiedWebSocketIdentity(headers)).toEqual({ memberId: 42, role: 'member' });
    expect(parseVerifiedWebSocketIdentity(new Headers({ 'X-MBFD-Member-Id': '42' }))).toBeNull();
    expect(
      parseVerifiedWebSocketIdentity(
        new Headers({ 'X-MBFD-Member-Id': '0', 'X-MBFD-Role': 'member' }),
      ),
    ).toBeNull();
    expect(
      parseVerifiedWebSocketIdentity(
        new Headers({ 'X-MBFD-Member-Id': '42.5', 'X-MBFD-Role': 'member' }),
      ),
    ).toBeNull();
  });

  it('uses the route-verified member identity for a live WebSocket pick', async () => {
    const bidSession = new BidSessionDO(makeStateMock(sessionId, storage), h.env);
    const socket = { send() {} } as unknown as WebSocket;
    const onMessage = bidSession as unknown as {
      onMessage(
        clientId: string,
        socket: WebSocket,
        event: MessageEvent,
        identity: { memberId: number; role: 'member' | 'admin' },
      ): Promise<void>;
    };

    await onMessage.onMessage(
      'connection-1',
      socket,
      { data: JSON.stringify({ type: 'hello', jwt: 'j'.repeat(20) }) } as MessageEvent,
      { memberId: 42, role: 'member' },
    );
    await onMessage.onMessage(
      'connection-1',
      socket,
      {
        data: JSON.stringify({
          type: 'submit_pick',
          positionId: 'A101',
          aDay: null,
          idempotencyKey: '11111111-1111-4111-8111-111111111111',
        }),
      } as MessageEvent,
      { memberId: 42, role: 'member' },
    );

    const persisted = await storage.get<BidSessionState>(`bs:${sessionId}:state`);
    expect(persisted?.fills.A101).toMatchObject({ memberId: 42, ordinal: 1 });
    expect(persisted?.currentPhase).toBe('complete');
  });

  it('forwards only verified JWT claims from the public WebSocket route to the DO', async () => {
    const doFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response('upstream'));
    const idFromName = vi.fn(() => ({}) as DurableObjectId);
    const bidSession = {
      idFromName,
      get: vi.fn(() => ({ fetch: doFetch })),
    } as unknown as DurableObjectNamespace;
    const router = new Hono<{ Bindings: WorkerEnv }>().route('/api/ws', ws);
    const jwt = await signJwt(
      {
        sub: 42,
        emp: '300042',
        role: 'member',
        rank: 'FF',
        first_name: 'Test',
        last_name: 'Bidder',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    const sessionPath = `/api/ws/session/${sessionId}?token=${encodeURIComponent(jwt)}`;
    const request = {
      headers: {
        Origin: 'https://staging.bid.mbfdhub.com',
        Upgrade: 'websocket',
      },
    };

    const accepted = await router.request(sessionPath, request, {
      ...h.env,
      BID_SESSION: bidSession,
    });

    expect(accepted.status).toBe(200);
    expect(idFromName).toHaveBeenCalledWith(sessionId);
    expect(doFetch).toHaveBeenCalledTimes(1);
    const [, init] = doFetch.mock.calls[0] ?? [];
    expect(init).toMatchObject({
      method: 'GET',
      headers: {
        Upgrade: 'websocket',
        'X-MBFD-Member-Id': '42',
        'X-MBFD-Role': 'member',
      },
    });

    const crossEnvironment = await router.request(
      sessionPath,
      {
        headers: { ...request.headers, Origin: 'https://bid.mbfdhub.com' },
      },
      { ...h.env, BID_SESSION: bidSession },
    );
    expect(crossEnvironment.status).toBe(403);

    const invalid = await router.request(`/api/ws/session/${sessionId}?token=not-a-jwt`, request, {
      ...h.env,
      BID_SESSION: bidSession,
    });
    expect(invalid.status).toBe(401);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});

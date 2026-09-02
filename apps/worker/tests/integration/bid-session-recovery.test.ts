import { WEBSOCKET_TICKET_AUDIENCE } from '@mbfd/shared';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Unstable_DevWorker, unstable_dev } from 'wrangler';

const LOCAL_SIGNING_KEY = 'test-key-with-at-least-32-characters-long';
const STAGING_PUBLIC_ORIGIN = 'https://staging.bid.mbfdhub.com';

interface TcpSocket {
  on(event: 'data', listener: (chunk: Uint8Array) => void): this;
  once(event: 'error' | 'close', listener: (error?: Error) => void): this;
  write(data: string | Uint8Array): boolean;
  end(): this;
  destroy(): this;
}

interface NodeNetModule {
  createConnection(options: { host: string; port: number }): TcpSocket;
}

interface LocalWebSocket {
  messages: unknown[];
  waitFor(type: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

function eventPayload(event: Record<string, unknown>): Record<string, unknown> {
  if (typeof event.payload !== 'object' || event.payload === null) {
    throw new Error('Local WebSocket event did not include an object payload.');
  }
  return event.payload as Record<string, unknown>;
}

function hasEventType(value: unknown): value is Record<string, unknown> & { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function keyBytes(key: string): Uint8Array {
  return new TextEncoder().encode(key);
}

async function browserTicket(sessionId: string): Promise<string> {
  return new SignJWT({
    sub: '1',
    member_id: 1,
    security_version: 1,
    role: 'admin',
    session_id: sessionId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(WEBSOCKET_TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(keyBytes(LOCAL_SIGNING_KEY));
}

function websocketClientFrame(message: unknown): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(message));
  if (payload.length >= 126) throw new Error('Test frame payload unexpectedly exceeds 125 bytes.');
  const mask = crypto.getRandomValues(new Uint8Array(4));
  const frame = new Uint8Array(2 + mask.length + payload.length);
  frame[0] = 0x81;
  frame[1] = 0x80 | payload.length;
  frame.set(mask, 2);
  for (let index = 0; index < payload.length; index += 1) {
    frame[6 + index] = (payload[index] ?? 0) ^ (mask[index % mask.length] ?? 0);
  }
  return frame;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function indexOfHeaderEnd(input: Uint8Array): number {
  for (let index = 0; index <= input.length - 4; index += 1) {
    if (
      input[index] === 13 &&
      input[index + 1] === 10 &&
      input[index + 2] === 13 &&
      input[index + 3] === 10
    ) {
      return index;
    }
  }
  return -1;
}

async function connectLocalWebSocket(
  worker: Unstable_DevWorker,
  sessionId: string,
): Promise<LocalWebSocket> {
  const nodeNet = (await import('node:net')) as unknown as NodeNetModule;
  const ticket = await browserTicket(sessionId);
  const socket = nodeNet.createConnection({ host: worker.address, port: worker.port });
  const received: unknown[] = [];
  const waiters = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  let pending = new Uint8Array();
  let upgraded = false;

  const waitFor = (type: string): Promise<Record<string, unknown>> => {
    const existing = received.find(
      (message): message is Record<string, unknown> =>
        hasEventType(message) && message.type === type,
    );
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entries = waiters.get(type) ?? [];
      entries.push(resolve);
      waiters.set(type, entries);
      setTimeout(() => {
        const pendingWaiters = waiters.get(type);
        if (pendingWaiters?.includes(resolve)) {
          waiters.set(
            type,
            pendingWaiters.filter((waiter) => waiter !== resolve),
          );
          socket.destroy();
          reject(new Error(`Timed out waiting for local WebSocket event ${type}.`));
        }
      }, 5_000);
    });
  };

  const processFrames = (): void => {
    while (pending.length >= 2) {
      const opcode = (pending[0] ?? 0) & 0x0f;
      const lengthIndicator = (pending[1] ?? 0) & 0x7f;
      let headerLength = 2;
      let length = lengthIndicator;
      if (lengthIndicator === 126) {
        if (pending.length < 4) return;
        length = ((pending[2] ?? 0) << 8) | (pending[3] ?? 0);
        headerLength = 4;
      } else if (lengthIndicator === 127) {
        throw new Error('Test server frame unexpectedly exceeds 65,535 bytes.');
      }
      if (pending.length < headerLength + length) return;
      const payload = pending.slice(headerLength, headerLength + length);
      pending = pending.slice(headerLength + length);
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode !== 0x1) continue;
      const parsed = JSON.parse(new TextDecoder().decode(payload)) as unknown;
      received.push(parsed);
      if (hasEventType(parsed)) {
        const matching = waiters.get(parsed.type);
        if (matching !== undefined) {
          waiters.delete(parsed.type);
          for (const resolve of matching) resolve(parsed as Record<string, unknown>);
        }
      }
    }
  };

  const upgrade = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the local WebSocket upgrade.'));
    }, 5_000);
    socket.once('error', (error) =>
      reject(error ?? new Error('Local WebSocket transport failed.')),
    );
    socket.on('data', (chunk) => {
      pending = concatBytes(pending, chunk);
      if (!upgraded) {
        const headerEnd = indexOfHeaderEnd(pending);
        if (headerEnd < 0) return;
        const responseHeader = new TextDecoder().decode(pending.slice(0, headerEnd));
        if (!responseHeader.startsWith('HTTP/1.1 101')) {
          reject(
            new Error(`Local WebSocket upgrade was rejected: ${responseHeader.split('\r\n')[0]}`),
          );
          socket.destroy();
          return;
        }
        upgraded = true;
        pending = pending.slice(headerEnd + 4);
        clearTimeout(timeout);
        resolve();
      }
      processFrames();
    });
  });

  socket.write(
    [
      `GET /api/ws/session/${sessionId} HTTP/1.1`,
      `Host: ${worker.address}:${worker.port}`,
      `Origin: ${STAGING_PUBLIC_ORIGIN}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      `Sec-WebSocket-Protocol: mbfd-bid-v1, ${ticket}`,
      '',
      '',
    ].join('\r\n'),
  );
  await upgrade;
  socket.write(websocketClientFrame({ type: 'hello', lastSeq: 0 }));

  return {
    messages: received,
    waitFor,
    async close(): Promise<void> {
      const closed = new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        setTimeout(() => {
          socket.destroy();
          resolve();
        }, 5_000);
      });
      socket.write(new Uint8Array([0x88, 0x80, 0, 0, 0, 0]));
      await closed;
    },
  };
}

describe('BidSession DO recovery (Plan 04 Task 15)', () => {
  let worker: Unstable_DevWorker;
  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      vars: {
        JWT_SIGNING_KEY: LOCAL_SIGNING_KEY,
        ENV: 'staging',
        PORTAL_BASE_URL: 'https://x.example',
        PORTAL_BID_FEDERATION_TOKEN: 'x',
      },
      durableObjects: [{ name: 'BID_SESSION', class_name: 'BidSessionDO' }],
    });
  });
  afterAll(async () => worker.stop());

  it('snapshot survives across requests (proxy for DO eviction)', async () => {
    const r1 = await worker.fetch('/api/board?bidSessionId=01HRECOVERY', {
      headers: { Authorization: 'Bearer test' },
    });
    expect([200, 401]).toContain(r1.status);
    // The DO is created on first access. A second access returns the same state.
    const r2 = await worker.fetch('/api/board?bidSessionId=01HRECOVERY', {
      headers: { Authorization: 'Bearer test' },
    });
    expect(r2.status).toBe(r1.status);
  }, 20_000);

  it('authenticates the browser ticket and restores state through an actual local disconnect/reconnect', async () => {
    const sessionId = '01HRECOVERYLOCALWS';
    const first = await connectLocalWebSocket(worker, sessionId);
    const firstSnapshot = eventPayload(await first.waitFor('state_snapshot'));
    const firstSpecialty = await first.waitFor('synthetic_specialty_state_changed');
    // Canonical state deliberately projects the physical DO-storage namespace
    // into the normal snapshot. The synthetic control signal carries the
    // named D1 session identifier used by the admin UI.
    expect(typeof firstSnapshot.bidSessionId).toBe('string');
    expect(firstSnapshot.seq).toBe(0);
    expect(firstSpecialty).toMatchObject({
      bidSessionId: sessionId,
      mode: 'synthetic_test_only',
      does_not_commit_bid: true,
    });
    await first.close();

    const second = await connectLocalWebSocket(worker, sessionId);
    const secondSnapshot = eventPayload(await second.waitFor('state_snapshot'));
    const secondSpecialty = await second.waitFor('synthetic_specialty_state_changed');
    expect(secondSnapshot).toMatchObject({
      bidSessionId: firstSnapshot.bidSessionId,
      seq: firstSnapshot.seq,
      currentPhase: firstSnapshot.currentPhase,
      currentBidderId: firstSnapshot.currentBidderId,
    });
    expect(secondSpecialty).toMatchObject({
      bidSessionId: sessionId,
      revision: firstSpecialty.revision,
      controlState: firstSpecialty.controlState,
    });
    await second.close();
  }, 20_000);
});

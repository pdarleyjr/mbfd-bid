import type { KVNamespace } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import adminAi from '../../src/routes/ai.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from '../integration/helpers/test-d1.js';

type FakeKv = KVNamespace & { store: Map<string, string> };

function makeKv(): FakeKv {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as FakeKv;
}

/**
 * Build a fake Workers AI streaming response. The binding emits OpenAI-style
 * SSE chunks of the form `data: {"response":"…"}\n\n`. The advise-deep route
 * forwards the upstream stream verbatim, so we just need a ReadableStream
 * containing a couple of SSE events plus a terminating `data: [DONE]\n\n`.
 */
function fakeWorkersAiStream(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode('data: {"response":"Hello"}\n\n'));
      controller.enqueue(enc.encode('data: {"response":" admin"}\n\n'));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function makeAi(stream: ReadableStream<Uint8Array>): Ai {
  return { run: vi.fn().mockResolvedValue(stream) } as unknown as Ai;
}

async function adminJwt(env: WorkerEnv): Promise<string> {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: 0,
    emp: 'admin',
    role: 'admin',
    rank: 'CHIEF',
    first_name: 'A',
    last_name: 'B',
    fresh_auth_at: Math.floor(Date.now() / 1000),
  };
  return signJwt(payload, env.JWT_SIGNING_KEY);
}

function mkApp() {
  return new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/ai', adminAi);
}

describe('POST /api/admin/ai/advise-deep', () => {
  let harness: TestD1;
  let env: WorkerEnv;

  beforeEach(async () => {
    harness = await setupTestD1();
    env = {
      ...harness.env,
      KV: makeKv(),
      AI_KV: makeKv(),
      AI: makeAi(fakeWorkersAiStream()),
    };
    await harness.db.run(
      `INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
       VALUES ('s1', 2026, ?, 'config', 180, 2, 0)`,
      [Date.now()],
    );
  });

  afterEach(async () => {
    await teardownTestD1(harness);
  });

  it('returns 401 without auth', async () => {
    const res = await mkApp().request(
      '/api/admin/ai/advise-deep',
      {
        method: 'POST',
        body: JSON.stringify({ session_id: 's1', question: 'q' }),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('streams text/event-stream with response chunks from Workers AI', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/advise-deep',
      {
        method: 'POST',
        body: JSON.stringify({ session_id: 's1', question: 'why force?' }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('"response":"Hello"');
    expect(text).toContain('"response":" admin"');
    expect(text).toContain('[DONE]');
  });

  it('returns 503 when feature flag off', async () => {
    (env.AI_KV as FakeKv).store.set('ai_advisory_enabled', 'false');
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/advise-deep',
      {
        method: 'POST',
        body: JSON.stringify({ session_id: 's1', question: 'q' }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
      },
      env,
    );
    expect(res.status).toBe(503);
  });

  it('returns 400 on bad body', async () => {
    const jwt = await adminJwt(env);
    const res = await mkApp().request(
      '/api/admin/ai/advise-deep',
      {
        method: 'POST',
        body: JSON.stringify({ session_id: '', question: '' }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});

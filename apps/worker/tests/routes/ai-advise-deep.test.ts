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

function fakeAnthropicSse(): Response {
  // Emit two text-delta events then message_stop. The SDK's stream consumer
  // requires content_block_start before deltas to track indices.
  const enc = new TextEncoder();
  const chunks = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"claude-opus-4-7","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" admin"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
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
    };
    await harness.db.run(
      `INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
       VALUES ('s1', 2026, ?, 'config', 180, 2, 0)`,
      [Date.now()],
    );
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeAnthropicSse(),
      // biome-ignore lint/suspicious/noExplicitAny: test-only fetch shim
    ) as any;
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

  it('streams text/event-stream with token deltas', async () => {
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
    expect(text).toContain('data: Hello');
    expect(text).toContain('data:  admin');
    expect(text).toContain('event: done');
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

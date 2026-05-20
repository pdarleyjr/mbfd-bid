import type { KVNamespace } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkersAIClient } from '../../src/ai/client.js';
import type { Advisory } from '../../src/ai/output-schema.js';
import type { WorkerEnv } from '../../src/types/env.js';
import canonicalRaw from './__fixtures__/advisory-canonical.json';

const canonical = canonicalRaw as unknown as Advisory;

type FakeKv = KVNamespace & { store: Map<string, string> };

function makeKv(): FakeKv {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as FakeKv;
}

interface AiStub {
  run: ReturnType<typeof vi.fn>;
}

function makeAi(response: unknown): AiStub {
  return { run: vi.fn().mockResolvedValue(response) };
}

function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'a'.repeat(64),
    PIN_HASH: 'x',
    PORTAL_BID_READER: 'tok',
    AI_BUDGET_CAP_CENTS: 2500,
    AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
    AI_KV: makeKv(),
    AI: makeAi({ response: JSON.stringify(canonical) }) as unknown as Ai,
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    BROWSER: {} as never,
    ...overrides,
  };
}

describe('WorkersAIClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: test-only fetch shim
    globalThis.fetch = fetchSpy as any;
  });

  it('invokes env.AI.run with the Llama model name (NOT globalThis.fetch)', async () => {
    const env = makeEnv();
    const client = new WorkersAIClient(env);
    const result = await client.adviseCurrent({
      bidSessionId: 'sess1',
      system: 'system prompt',
      user: 'roster + turn',
    });
    expect(result.advisory).not.toBeNull();
    const aiRun = (env.AI as unknown as AiStub).run;
    expect(aiRun).toHaveBeenCalledTimes(1);
    const calls = aiRun.mock.calls[0] ?? [];
    expect(calls[0]).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses JSON output from response.response field', async () => {
    const env = makeEnv();
    const client = new WorkersAIClient(env);
    const result = await client.adviseCurrent({
      bidSessionId: 'sess1',
      system: 'sys',
      user: 'turn',
    });
    expect(result.stale).toBe(false);
    expect(result.advisory.summary).toBe(canonical.summary);
  });

  it('records cost (neurons → 0 cents) to KV after a successful call', async () => {
    const env = makeEnv();
    const client = new WorkersAIClient(env);
    await client.adviseCurrent({
      bidSessionId: 'sess1',
      system: 'sys',
      user: 'turn',
    });
    const kv = env.AI_KV as FakeKv;
    // We still write the key (even if 0) so cost-accounting tests stay happy
    expect(kv.store.has('ai_cost_cents:sess1')).toBe(true);
    expect(Number(kv.store.get('ai_cost_cents:sess1'))).toBe(0);
  });

  it('returns stale-last-good envelope on env.AI.run rejection', async () => {
    const env = makeEnv({
      AI: { run: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Ai,
    });
    const kv = env.AI_KV as FakeKv;
    kv.store.set(
      'ai_last_good:sess1',
      JSON.stringify({ advisory: canonical, generated_at_ms: 1000, ai_advisory_id: 'prev123' }),
    );
    const client = new WorkersAIClient(env);
    const env2 = await client.adviseCurrent({
      bidSessionId: 'sess1',
      system: 'sys',
      user: 'turn',
    });
    expect(env2.stale).toBe(true);
    expect(env2.fallback).toBe('last_good');
  });

  it('returns deterministic-fallback envelope when no last-good exists', async () => {
    const env = makeEnv({
      AI: { run: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Ai,
    });
    const client = new WorkersAIClient(env);
    const r = await client.adviseCurrent({
      bidSessionId: 'sessX',
      system: 'sys',
      user: 'turn',
      deterministicFallback: { advisory: canonical },
    });
    expect(r.stale).toBe(true);
    expect(r.fallback).toBe('deterministic');
  });

  it('refuses to call when budget cap exceeded', async () => {
    const env = makeEnv();
    const kv = env.AI_KV as FakeKv;
    kv.store.set('ai_cost_cents:sessOver', '3000');
    const client = new WorkersAIClient(env);
    const r = await client.adviseCurrent({
      bidSessionId: 'sessOver',
      system: 'sys',
      user: 'turn',
    });
    expect(r.stale).toBe(true);
    const aiRun = (env.AI as unknown as AiStub).run;
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('refuses to call when feature flag disabled', async () => {
    const env = makeEnv();
    const kv = env.AI_KV as FakeKv;
    kv.store.set('ai_advisory_enabled', 'false');
    const client = new WorkersAIClient(env);
    const r = await client.adviseCurrent({
      bidSessionId: 'sessFlag',
      system: 'sys',
      user: 'turn',
    });
    expect(r.stale).toBe(true);
    const aiRun = (env.AI as unknown as AiStub).run;
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('prompt_hash is deterministic for same inputs', async () => {
    const env = makeEnv();
    const client = new WorkersAIClient(env);
    const h1 = await client.hashPrompt('a', 'b', 'c');
    const h2 = await client.hashPrompt('a', 'b', 'c');
    const h3 = await client.hashPrompt('a', 'b', 'd');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('adviseDeepStream returns a ReadableStream from env.AI.run with stream: true', async () => {
    const enc = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('data: hello\n\n'));
        controller.close();
      },
    });
    const env = makeEnv({
      AI: { run: vi.fn().mockResolvedValue(upstream) } as unknown as Ai,
    });
    const client = new WorkersAIClient(env);
    const stream = await client.adviseDeepStream({
      bidSessionId: 'sessStream',
      system: 'sys',
      user: 'turn',
    });
    expect(stream).toBeInstanceOf(ReadableStream);
    const aiRun = (env.AI as unknown as AiStub).run;
    const callArgs = aiRun.mock.calls[0] ?? [];
    expect(callArgs[1]).toMatchObject({ stream: true });
  });
});

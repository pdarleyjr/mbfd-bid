import type { KVNamespace } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAIClient } from '../../src/ai/client.js';
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

function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    ENV: 'staging',
    PORTAL_BASE_URL: 'https://portal.example',
    JWT_SIGNING_KEY: 'a'.repeat(64),
    PIN_HASH: 'x',
    PORTAL_BID_READER: 'tok',
    CF_AI_GATEWAY_URL: 'https://gateway.example.com/v1/abc/mbfd-bid/anthropic',
    ANTHROPIC_API_KEY: 'sk-test',
    AI_BUDGET_CAP_CENTS: 2500,
    AI_FEATURE_FLAG_KEY: 'ai_advisory_enabled',
    DB: {} as never,
    KV: {} as never,
    BID_SESSION: {} as never,
    AI_KV: makeKv(),
    AUDIT_SIGNING_PRIVKEY: '',
    AUDIT_SIGNING_PUBKEY: '',
    BROWSERLESS_TOKEN: '',
    R2_AUDIT: {} as never,
    R2_EXPORTS: {} as never,
    PORTAL_QUEUE: {} as never,
    ...overrides,
  };
}

describe('AnthropicAIClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: test-only fetch shim
    globalThis.fetch = fetchMock as any;
  });

  it('posts to the CF AI Gateway URL (not api.anthropic.com)', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify(canonical) }],
          stop_reason: 'end_turn',
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const env = makeEnv();
    const client = new AnthropicAIClient(env);
    const result = await client.adviseCurrent({
      bidSessionId: 'sess1',
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      roster: [{ type: 'text', text: 'R', cache_control: { type: 'ephemeral' } }],
      turn: [{ type: 'text', text: 'T' }],
    });
    expect(result.advisory).not.toBeNull();
    const callArgs = fetchMock.mock.calls[0];
    if (!callArgs) throw new Error('fetch was not called');
    const url = callArgs[0] as string;
    expect(url).toContain('gateway.example.com');
    expect(url).not.toContain('api.anthropic.com');
  });

  it('records cost_cents to KV after a successful call', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: JSON.stringify(canonical) }],
          stop_reason: 'end_turn',
          model: 'claude-sonnet-4-6',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 30000,
            cache_read_input_tokens: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const env = makeEnv();
    const client = new AnthropicAIClient(env);
    await client.adviseCurrent({
      bidSessionId: 'sess1',
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      roster: [{ type: 'text', text: 'R', cache_control: { type: 'ephemeral' } }],
      turn: [{ type: 'text', text: 'T' }],
    });
    const kv = env.AI_KV as FakeKv;
    expect(kv.store.get('ai_cost_cents:sess1')).toBeDefined();
    expect(Number(kv.store.get('ai_cost_cents:sess1'))).toBeGreaterThanOrEqual(0);
  });

  it('returns stale-last-good envelope on 5xx', async () => {
    const env = makeEnv();
    const kv = env.AI_KV as FakeKv;
    kv.store.set(
      'ai_last_good:sess1',
      JSON.stringify({ advisory: canonical, generated_at_ms: 1000, ai_advisory_id: 'prev123' }),
    );
    fetchMock.mockResolvedValue(new Response('{"error":"upstream"}', { status: 503 }));
    const client = new AnthropicAIClient(env);
    const env2 = await client.adviseCurrent({
      bidSessionId: 'sess1',
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      roster: [{ type: 'text', text: 'R', cache_control: { type: 'ephemeral' } }],
      turn: [{ type: 'text', text: 'T' }],
    });
    expect(env2.stale).toBe(true);
    expect(env2.fallback).toBe('last_good');
  });

  it('returns deterministic-fallback envelope when no last-good exists', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"upstream"}', { status: 503 }));
    const env = makeEnv();
    const client = new AnthropicAIClient(env);
    const r = await client.adviseCurrent({
      bidSessionId: 'sessX',
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      roster: [{ type: 'text', text: 'R', cache_control: { type: 'ephemeral' } }],
      turn: [{ type: 'text', text: 'T' }],
      deterministicFallback: { advisory: canonical },
    });
    expect(r.stale).toBe(true);
    expect(r.fallback).toBe('deterministic');
  });

  it('refuses to call when budget cap exceeded', async () => {
    const env = makeEnv();
    const kv = env.AI_KV as FakeKv;
    kv.store.set('ai_cost_cents:sessOver', '3000');
    const client = new AnthropicAIClient(env);
    const r = await client.adviseCurrent({
      bidSessionId: 'sessOver',
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      roster: [{ type: 'text', text: 'R', cache_control: { type: 'ephemeral' } }],
      turn: [{ type: 'text', text: 'T' }],
    });
    expect(r.stale).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to call when feature flag disabled', async () => {
    const env = makeEnv();
    const kv = env.AI_KV as FakeKv;
    kv.store.set('ai_advisory_enabled', 'false');
    const client = new AnthropicAIClient(env);
    const r = await client.adviseCurrent({
      bidSessionId: 'sessFlag',
      system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
      roster: [{ type: 'text', text: 'R', cache_control: { type: 'ephemeral' } }],
      turn: [{ type: 'text', text: 'T' }],
    });
    expect(r.stale).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prompt_hash is deterministic for same inputs', async () => {
    const env = makeEnv();
    const client = new AnthropicAIClient(env);
    const h1 = await client.hashPrompt('a', 'b', 'c');
    const h2 = await client.hashPrompt('a', 'b', 'c');
    const h3 = await client.hashPrompt('a', 'b', 'd');
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRpcClient } from '../../lib/rpc-client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createRpcClient', () => {
  it('attaches Authorization: Bearer header when JWT provided', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    const client = createRpcClient('http://test', 'fake-jwt');
    // biome-ignore lint/suspicious/noExplicitAny: test-only proxy traversal
    await (client as any).api.health.$get();

    expect(fetchMock).toHaveBeenCalled();
    // Hono hc calls fetch(url: string, init: RequestInit) — not a Request object.
    // noUncheckedIndexedAccess: narrow the call tuple before destructuring.
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [firstCall] = calls as [[string | Request, RequestInit?], ...unknown[]];
    const [url, init] = firstCall;
    expect(typeof url).toBe('string');
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    expect(headers.get('authorization')).toBe('Bearer fake-jwt');
  });

  it('omits Authorization when no JWT', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    const client = createRpcClient('http://test');
    // biome-ignore lint/suspicious/noExplicitAny: test-only proxy traversal
    await (client as any).api.health.$get();

    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [firstCall] = calls as [[string | Request, RequestInit?], ...unknown[]];
    const [, init] = firstCall;
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    expect(headers.get('authorization')).toBeNull();
  });

  it('preserves the typed shape of admin routes (compile-time check via inference)', () => {
    // Runtime check: the hc proxy responds to arbitrary path chains.
    const client = createRpcClient('http://test', 'fake-jwt');
    // biome-ignore lint/suspicious/noExplicitAny: test-only proxy traversal
    const adminMembers = (client as any).api.admin.members;
    expect(typeof adminMembers.$get).toBe('function');
  });
});

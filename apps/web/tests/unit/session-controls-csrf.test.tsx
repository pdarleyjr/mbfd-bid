// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionControls } from '../../app/admin/sessions/[id]/SessionControls';
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../../app/admin/sessions/[id]/ForcePickSheet', () => ({ ForcePickSheet: () => null }));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  refresh.mockClear();
});
it('starts the selected managed session through the CSRF-protected lifecycle endpoint', async () => {
  const token = 'csrf_00000000-0000-0000-0000-000000000001';
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url === '/api/auth/csrf') return new Response(JSON.stringify({ token }));
      if (url === '/api/admin/bid-session/synthetic%20mock/start')
        return new Response(JSON.stringify({ current_phase: 'position_bid' }));
      throw new Error(`Unexpected request ${url}`);
    }),
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<SessionControls sessionId="synthetic mock" />));
  const start = [...host.querySelectorAll('button')].find(
    (node) => node.textContent === 'Start session',
  );
  if (!start) throw new Error('Start control missing');
  await act(async () => {
    start.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(calls.map((call) => call.url)).toEqual([
    '/api/auth/csrf',
    '/api/admin/bid-session/synthetic%20mock/start',
  ]);
  expect(new Headers(calls[1]?.init?.headers).get('X-MBFD-CSRF')).toBe(token);
  expect(calls[1]?.init?.method).toBe('POST');
  expect(host.textContent).toContain('OK: start');
  expect(refresh).toHaveBeenCalledOnce();
});

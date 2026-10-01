// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StepUpProvider } from '../../app/admin/_components/StepUpProvider';
import { OPERATOR_AUTH_REFRESHED, OPERATOR_REAUTH_STARTED } from '../../lib/operator-step-up';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const NOW = 1800000000;
const OPERATOR = '901:901:1';
const clients: QueryClient[] = [];
const roots: ReturnType<typeof createRoot>[] = [];
let response: Response;
const requests: Array<{ url: string; method: string }> = [];
const status = () => ({ operatorKey: OPERATOR, freshAuthAtSec: NOW, serverNowSec: NOW });
beforeEach(() => {
  requests.length = 0;
  response = Response.json(status());
  vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET' });
      return response.clone();
    }),
  );
});
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const client of clients.splice(0)) client.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(age = 0, verified = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <StepUpProvider
          initialStatus={verified ? { ...status(), freshAuthAtSec: NOW - age } : undefined}
        >
          <textarea aria-label="Unfinished reason" defaultValue="Keep this reviewed reason" />
        </StepUpProvider>
      </QueryClientProvider>,
    ),
  );
  return container;
}
async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Missing ${text}`);
  await act(async () => button.click());
}
async function command() {
  let result: Response | undefined;
  await act(async () => {
    result = await window.fetch('/api/admin/bid-session/synthetic/command', {
      method: 'POST',
      body: '{"expectedSeq":7}',
    });
  });
  return result;
}

describe('operator step-up recovery', () => {
  it('forwards a command younger than five minutes once', async () => {
    await mount(299);
    response = Response.json({ ok: true });
    expect((await command())?.status).toBe(200);
    expect(requests).toHaveLength(1);
  });
  it('shows expiration and keeps the reason in place without sending an expired command', async () => {
    await mount(300);
    expect(document.body.textContent).toContain('Operator sign-in expired');
    expect((await command())?.status).toBe(401);
    expect(requests).toHaveLength(0);
    expect(document.querySelector('textarea')?.value).toBe('Keep this reviewed reason');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
  it('reauthenticates in a separate tab, rechecks server authority, and requires a deliberate retry', async () => {
    await mount();
    response = Response.json({ error: 'step_up_required' }, { status: 401 });
    await command();
    const link = document.querySelector<HTMLAnchorElement>('[role="dialog"] a');
    expect(link?.target).toBe('_blank');
    expect(link?.href).toContain('/api/auth/start?returnTo=%2Fadmin%2Fstep-up');
    response = Response.json(status());
    await click('Recheck sign-in');
    expect(document.querySelector('textarea')?.value).toBe('Keep this reviewed reason');
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(1);
    expect(document.body.textContent).toContain('Review the latest state, then retry');
    response = Response.json({ ok: true });
    await command();
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(2);
  });
  it('keeps the console and draft after cancellation or failed reauthentication', async () => {
    await mount(300);
    await command();
    await click('Keep working');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click('Refresh operator sign-in');
    response = Response.json({ error: 'invalid_identity' }, { status: 401 });
    await click('Recheck sign-in');
    expect(document.querySelector('textarea')?.value).toBe('Keep this reviewed reason');
    expect(document.body.textContent).toContain('Sign-in could not be verified');
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(0);
  });
  it.each(['902:901:1', '901:902:1', '901:901:2'])(
    'blocks changed operator identity %s until the console is reopened',
    async (operatorKey) => {
      await mount(300);
      await command();
      response = Response.json({ ...status(), operatorKey });
      await click('Recheck sign-in');
      expect(document.body.textContent).toContain('Operator identity changed');
      expect((await command())?.status).toBe(401);
      expect(requests.filter((item) => item.method === 'POST')).toHaveLength(0);
    },
  );
  it('captures reauthentication start before sign-in or server recheck and never replays a command', async () => {
    await mount();
    const signals: string[] = [];
    const onStart = () => signals.push('start');
    const onRefresh = () => signals.push('refreshed');
    window.addEventListener(OPERATOR_REAUTH_STARTED, onStart);
    window.addEventListener(OPERATOR_AUTH_REFRESHED, onRefresh);
    try {
      await click('Refresh operator sign-in');
      const link = document.querySelector<HTMLAnchorElement>('[role="dialog"] a');
      if (!link) throw new Error('Missing sign-in link');
      await act(async () => link.click());
      expect(signals).toEqual(['start']);
      expect((await command())?.status).toBe(401);
      expect(requests).toEqual([]);
      await click('Recheck sign-in');
      expect(signals).toEqual(['start', 'start', 'refreshed']);
      expect(requests).toEqual([{ url: '/api/auth/operator-status', method: 'GET' }]);
      expect(document.querySelector('textarea')?.value).toBe('Keep this reviewed reason');
    } finally {
      window.removeEventListener(OPERATOR_REAUTH_STARTED, onStart);
      window.removeEventListener(OPERATOR_AUTH_REFRESHED, onRefresh);
    }
  });
  it('blocks writes during a failed proactive recheck even if the displayed freshness was recent', async () => {
    await mount();
    await click('Refresh operator sign-in');
    response = Response.json({ error: 'session_revalidation_required' }, { status: 401 });
    await click('Recheck sign-in');
    expect((await command())?.status).toBe(401);
    expect(requests).toEqual([{ url: '/api/auth/operator-status', method: 'GET' }]);
    expect(document.querySelector('textarea')?.value).toBe('Keep this reviewed reason');
  });
  it('fails closed when the original operator context was not supplied', async () => {
    await mount(0, false);
    expect((await command())?.status).toBe(401);
    expect(requests).toEqual([]);
  });
  it('treats server identity rejection as a required recheck and preserves the unsent retry', async () => {
    await mount();
    response = Response.json({ error: 'missing_auth' }, { status: 401 });
    await command();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect((await command())?.status).toBe(401);
    expect(requests.filter((item) => item.method === 'POST')).toHaveLength(1);
    expect(document.querySelector('textarea')?.value).toBe('Keep this reviewed reason');
  });
  it('keeps writes blocked if canonical refresh rejects the session after a successful status recheck', async () => {
    await mount(300);
    await command();
    const client = clients.at(-1);
    if (!client) throw new Error('Missing query client');
    vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {
      response = Response.json({ error: 'missing_auth' }, { status: 401 });
      await window.fetch('/api/admin/bid-session/synthetic/state');
    });
    response = Response.json(status());
    const refreshed = vi.fn();
    window.addEventListener(OPERATOR_AUTH_REFRESHED, refreshed);
    try {
      await click('Recheck sign-in');
      expect(refreshed).not.toHaveBeenCalled();
      expect((await command())?.status).toBe(401);
      expect(requests.filter((item) => item.method === 'POST')).toHaveLength(0);
      expect(document.querySelector('textarea')?.value).toBe('Keep this reviewed reason');
    } finally {
      window.removeEventListener(OPERATOR_AUTH_REFRESHED, refreshed);
    }
  });
});

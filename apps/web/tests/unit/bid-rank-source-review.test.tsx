// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BidRankSourceReview } from '../../app/admin/current-bid/BidRankSourceReview';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const fetcher = vi.fn<typeof fetch>();
const YEAR = 2026;
const ARCHIVE = 'a'.repeat(64);
const SNAPSHOT = 'b'.repeat(64);
const VERSION = 'c'.repeat(64);
const RECEIPT = 'd'.repeat(64);
const SESSION = 'prepared-real';
let host: HTMLDivElement;
let root: Root;

function session(id = SESSION) {
  return {
    id,
    isMock: false,
    phase: 'config',
    alreadyApplied: false,
    sourceReceiptSha256: null as string | null,
    expectedSnapshotSha256: SNAPSHOT,
    expectedVersionSha256: VERSION,
  };
}

function review(year = YEAR) {
  return { year, archiveSha256: ARCHIVE as string | null, available: true, sessions: [session()] };
}

function receipt(alreadyApplied = false) {
  return {
    sessionId: SESSION,
    archiveSha256: ARCHIVE,
    receiptSha256: RECEIPT,
    memberCount: 218,
    referenceCount: 1497,
    alreadyApplied,
  };
}

function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function defaultImplementation() {
  const implementation = fetcher.getMockImplementation();
  if (!implementation) throw new Error('Missing default fetch implementation');
  return implementation;
}

function mutationRequests() {
  return fetcher.mock.calls.filter(([url]) => String(url).endsWith('/score-reference'));
}

function button(label: string) {
  const found = [...host.querySelectorAll('button')].find((entry) => entry.textContent === label);
  if (!found) throw new Error(`Missing ${label} button`);
  return found;
}

async function render(year = YEAR) {
  await act(async () => root.render(<BidRankSourceReview year={year} />));
}

async function open() {
  const details = host.querySelector('details');
  if (!details) throw new Error('Missing priority disclosure');
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockImplementation(async (input) => {
    if (String(input) === '/api/auth/csrf')
      return reply({ token: 'csrf_11111111-1111-4111-8111-111111111111' });
    if (String(input).endsWith('/score-review')) return reply(review());
    if (String(input).endsWith('/score-reference')) return reply(receipt());
    throw new Error(`Unexpected endpoint ${String(input)}`);
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  fetcher.mockReset();
  vi.unstubAllGlobals();
});

describe('final specialty source priorities', () => {
  it('stays collapsed and reads the exact prepared Real review only when opened', async () => {
    await render();
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.querySelector('details')?.open).toBe(false);
    await open();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/bid-forms/2026/score-review',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    );
    expect(host.textContent).toContain(
      'Uses the published rank lists for priority. Certification requirements and selections stay unchanged.',
    );
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/bid?session_id=prepared-real',
    );
    expect(mutationRequests()).toHaveLength(0);
  });

  it.each([
    'wrong-year',
    'duplicate-session',
    'unavailable-source',
    'active-session',
    'wrong-pin',
    'read-error',
  ] as const)('does not apply from a %s review', async (kind) => {
    fetcher.mockImplementation(async () => {
      if (kind === 'read-error') throw new Error('Synthetic network error');
      const data = review();
      if (kind === 'wrong-year') data.year = 2027;
      if (kind === 'duplicate-session') data.sessions.push(session());
      if (kind === 'unavailable-source') data.archiveSha256 = null;
      if (kind === 'active-session') data.sessions[0] = { ...session(), phase: 'position_bid' };
      if (kind === 'wrong-pin')
        data.sessions[0] = { ...session(), expectedSnapshotSha256: 'not-a-hash' };
      return reply(data);
    });
    await render();
    await open();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(button('Apply final priorities').disabled).toBe(true);
    expect(mutationRequests()).toHaveLength(0);
  });

  it('does not expose Mock sessions or offer an action without published priorities', async () => {
    fetcher.mockResolvedValue(reply({ ...review(), sessions: [{ ...session(), isMock: true }] }));
    await render();
    await open();
    expect(host.textContent).toContain('No prepared Real Bid is available.');
    expect(button('Apply final priorities').disabled).toBe(true);
    fetcher.mockResolvedValue(
      reply({ year: YEAR, archiveSha256: null, available: false, sessions: [] }),
    );
    await act(async () => button('Reload priorities').click());
    expect(host.textContent).toContain('Publish the final rank lists first.');
    expect(mutationRequests()).toHaveLength(0);
  });

  it('posts all exact expected pins with CSRF and displays the verified receipt', async () => {
    await render();
    await open();
    await act(async () => button('Apply final priorities').click());
    expect(mutationRequests()).toHaveLength(1);
    const request = mutationRequests()[0];
    if (!request) throw new Error('Missing priority request');
    expect(request[0]).toBe('/api/admin/bid-forms/2026/sessions/prepared-real/score-reference');
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      archiveSha256: ARCHIVE,
      expectedSnapshotSha256: SNAPSHOT,
      expectedVersionSha256: VERSION,
    });
    expect(new Headers(request[1]?.headers).get('X-MBFD-CSRF')).toMatch(/^csrf_/);
    expect(host.textContent).toContain('Final priorities applied · 218 members · 1497 references.');
    expect(button('Apply final priorities').disabled).toBe(true);
  });

  it('blocks double-clicks synchronously and handles an idempotent response', async () => {
    const pending = deferred<Response>();
    const original = defaultImplementation();
    fetcher.mockImplementation((url, init) =>
      String(url).endsWith('/score-reference') ? pending.promise : original(url, init),
    );
    await render();
    await open();
    await act(async () => {
      const apply = button('Apply final priorities');
      apply.click();
      apply.click();
    });
    expect(mutationRequests()).toHaveLength(1);
    await act(async () => pending.resolve(reply(receipt(true))));
    expect(host.textContent).toContain('Final priorities were already applied.');
  });

  it('keeps the chosen session after conflict, requires reload, then uses the refreshed pins', async () => {
    const original = defaultImplementation();
    let conflict = true;
    fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith('/score-reference') && conflict)
        return Promise.resolve(reply({ error: 'stale' }, 409));
      if (String(url).endsWith('/score-review'))
        return Promise.resolve(
          reply({
            ...review(),
            sessions: [
              { ...session(), expectedSnapshotSha256: conflict ? SNAPSHOT : 'e'.repeat(64) },
            ],
          }),
        );
      return original(url, init);
    });
    await render();
    await open();
    await act(async () => button('Apply final priorities').click());
    expect(button('Apply final priorities').disabled).toBe(true);
    expect(host.textContent).toContain('Reload priorities before applying again.');
    conflict = false;
    await act(async () => button('Reload priorities').click());
    expect(button('Apply final priorities').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => button('Apply final priorities').click());
    expect(JSON.parse(String(mutationRequests()[1]?.[1]?.body)).expectedSnapshotSha256).toBe(
      'e'.repeat(64),
    );
  });

  it.each(['wrong-session', 'wrong-archive', 'corrupt'] as const)(
    'does not claim success from a %s receipt',
    async (kind) => {
      const original = defaultImplementation();
      fetcher.mockImplementation((url, init) =>
        String(url).endsWith('/score-reference')
          ? Promise.resolve(
              reply(
                kind === 'corrupt'
                  ? {}
                  : {
                      ...receipt(),
                      sessionId: kind === 'wrong-session' ? 'other-session' : SESSION,
                      archiveSha256: kind === 'wrong-archive' ? 'f'.repeat(64) : ARCHIVE,
                    },
              ),
            )
          : original(url, init),
      );
      await render();
      await open();
      await act(async () => button('Apply final priorities').click());
      expect(host.textContent).toContain('The priority receipt could not be verified.');
      expect(host.textContent).not.toContain('Final priorities applied ·');
      expect(button('Apply final priorities').disabled).toBe(true);
    },
  );

  it('requires an explicit target when multiple prepared Real bids exist', async () => {
    fetcher.mockResolvedValue(
      reply({ ...review(), sessions: [session('first'), session('second')] }),
    );
    await render();
    await open();
    expect(button('Apply final priorities').disabled).toBe(true);
    const select = host.querySelector('select');
    if (!select) throw new Error('Missing target selector');
    await act(async () => {
      select.value = 'second';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(button('Apply final priorities').disabled).toBe(false);
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/admin/bid?session_id=second');
    expect(mutationRequests()).toHaveLength(0);
  });

  it('ignores an old-year review and aborts it', async () => {
    const pending = deferred<Response>();
    fetcher.mockImplementation((url) =>
      String(url).includes('/2026/')
        ? pending.promise
        : Promise.resolve(
            reply({ year: 2027, archiveSha256: null, available: false, sessions: [] }),
          ),
    );
    await render();
    await open();
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    await render(2027);
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(reply(review())));
    expect(host.textContent).toContain('Publish the final rank lists first.');
    expect(host.querySelector('a')).toBeNull();
    expect(mutationRequests()).toHaveLength(0);
  });

  it('aborts an old-year mutation and never presents its receipt for a new year', async () => {
    const pending = deferred<Response>();
    const original = defaultImplementation();
    fetcher.mockImplementation((url, init) => {
      if (String(url).endsWith('/score-reference')) return pending.promise;
      if (String(url).includes('/2027/'))
        return Promise.resolve(
          reply({ year: 2027, archiveSha256: null, available: false, sessions: [] }),
        );
      return original(url, init);
    });
    await render();
    await open();
    await act(async () => button('Apply final priorities').click());
    const signal = mutationRequests()[0]?.[1]?.signal;
    await render(2027);
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(reply(receipt())));
    expect(host.textContent).not.toContain('Final priorities applied ·');
    expect(host.querySelector('a')).toBeNull();
  });
});

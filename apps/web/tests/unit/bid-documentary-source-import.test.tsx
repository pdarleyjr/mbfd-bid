// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BidFormArchive, bidFormArchiveHash } from '../../../worker/src/lib/bid-form-source';
import { BidDocumentarySourceImport } from '../../app/admin/current-bid/BidDocumentarySourceImport';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const fetcher = vi.fn<typeof fetch>();
const YEAR = 2026;
const CURRENT_SHA = 'b'.repeat(64);
const PUBLISHED_AT = '2026-10-05T13:00:00.000Z';
let host: HTMLDivElement;
let root: Root;

function archive(): BidFormArchive {
  return {
    v: 1,
    year: YEAR,
    source: { name: 'Synthetic final forms.xlsx', sha256: 'a'.repeat(64) },
    forms: [
      {
        employeeId: 'synthetic-1',
        sourceName: 'Member, Test',
        sourceRank: 'Captain',
        attendingTeams: 'Yes',
        phone1: 'PRIVATE_CONTACT_NOT_FOR_PREVIEW',
        phone2: null,
        positionPreferences: [{ order: 1, shift: 'A', unit: 'Engine 2' }],
        aDayPreferences: [{ order: 1, sourceLabel: 'A Group 1', shift: 'A', group: 'G1' }],
        sourceLocation: { sheet: 'Final export', row: 3 },
      },
    ],
    notSubmitted: [],
    unlinkedNotSubmitted: [],
  };
}

function metadata(status: 'PUBLISHED' | 'NONE' = 'PUBLISHED', sha256 = CURRENT_SHA, year = YEAR) {
  return {
    year,
    status,
    archiveSha256: status === 'PUBLISHED' ? sha256 : null,
    publishedAt: status === 'PUBLISHED' ? PUBLISHED_AT : null,
    source: status === 'PUBLISHED' ? { name: 'Prior source.xlsx', sha256: 'c'.repeat(64) } : null,
    submittedForms: status === 'PUBLISHED' ? 1 : 0,
    notSubmitted: 0,
    airTechReferences: 0,
    rankLists: 0,
    rankRows: 0,
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

function publicationRequests() {
  return fetcher.mock.calls.filter(([url]) => String(url) === '/api/admin/bid-forms');
}

function defaultImplementation() {
  const implementation = fetcher.getMockImplementation();
  if (!implementation) throw new Error('Missing default fetch implementation');
  return implementation;
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  throw new Error('Expected asynchronous state did not settle');
}

async function render(year = YEAR) {
  await act(async () => root.render(<BidDocumentarySourceImport year={year} />));
}

async function open() {
  const details = host.querySelector('details');
  if (!details) throw new Error('Missing source disclosure');
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
}

function button(name: string) {
  const found = [...host.querySelectorAll('button')].find((entry) => entry.textContent === name);
  if (!found) throw new Error(`Missing ${name} button`);
  return found;
}

async function select(value: unknown = archive(), name = 'reviewed.json', size?: number) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Missing file selector');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await waitFor(() => !host.textContent?.includes('Checking selected file…'));
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockImplementation(async (input, init) => {
    if (String(input) === '/api/auth/csrf')
      return reply({ token: 'csrf_11111111-1111-4111-8111-111111111111' });
    if (String(input).endsWith('/source')) return reply(metadata());
    if (String(input) === '/api/admin/bid-forms') {
      const body = JSON.parse(String(init?.body)) as { archive: BidFormArchive };
      return reply(
        {
          year: body.archive.year,
          sha256: await bidFormArchiveHash(body.archive),
          publishedAt: PUBLISHED_AT,
          alreadyPublished: false,
        },
        201,
      );
    }
    throw new Error(`Unexpected endpoint ${String(input)}`);
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  fetcher.mockReset();
});

describe('collapsed documentary source publisher', () => {
  it('does no work until opened, then reads only source metadata without exposing contacts', async () => {
    await render();
    expect(fetcher).not.toHaveBeenCalled();
    expect(host.querySelector('details')?.open).toBe(false);
    await open();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/bid-forms/2026/source',
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    );
    await select();
    expect(host.textContent).toContain('reviewed.json · 1 forms · 0 rank lists');
    expect(host.textContent).not.toContain('PRIVATE_CONTACT_NOT_FOR_PREVIEW');
    expect(publicationRequests()).toHaveLength(0);
  });

  it.each([
    'wrong-year',
    'duplicate-member',
    'invalid-json',
    'too-large',
    'invalid-shape',
  ] as const)('rejects %s before any publication', async (kind) => {
    await render();
    await open();
    const source = archive();
    if (kind === 'wrong-year') source.year = 2027;
    if (kind === 'duplicate-member') {
      const member = source.forms[0];
      if (!member) throw new Error('Missing synthetic form');
      source.forms.push({ ...member });
    }
    await select(
      kind === 'invalid-json' ? '{bad json' : kind === 'invalid-shape' ? { year: YEAR } : source,
      'reviewed.json',
      kind === 'too-large' ? 1_048_577 : undefined,
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(button('Publish source').disabled).toBe(true);
    expect(publicationRequests()).toHaveLength(0);
  });

  it.each(['wrong-year', 'corrupt', 'missing', 'read-error'] as const)(
    'does not publish when saved metadata is %s',
    async (kind) => {
      fetcher.mockImplementation(async () => {
        if (kind === 'read-error') throw new Error('Synthetic network error');
        if (kind === 'missing') return reply({ error: 'source_unavailable' }, 503);
        return reply(
          kind === 'wrong-year'
            ? metadata('PUBLISHED', CURRENT_SHA, 2027)
            : { ...metadata(), archiveSha256: null },
        );
      });
      await render();
      await open();
      await select();
      expect(button('Publish source').disabled).toBe(true);
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      expect(publicationRequests()).toHaveLength(0);
    },
  );

  it.each(['PUBLISHED', 'NONE'] as const)(
    'publishes the exact structured archive with the expected hash for %s',
    async (status) => {
      const defaultFetch = defaultImplementation();
      fetcher.mockImplementation((url, init) =>
        String(url).endsWith('/source')
          ? Promise.resolve(reply(metadata(status)))
          : defaultFetch(url, init),
      );
      await render();
      await open();
      await select();
      await act(async () => button('Publish source').click());
      await waitFor(
        () => host.textContent?.includes('Source published for Mock and Real bids.') === true,
      );
      const requests = publicationRequests();
      expect(requests).toHaveLength(1);
      const request = requests[0];
      if (!request) throw new Error('Missing publication request');
      const [, init] = request;
      const body = JSON.parse(String(init?.body));
      expect(body.archive).toEqual(archive());
      if (status === 'PUBLISHED') expect(body.expectedArchiveSha256).toBe(CURRENT_SHA);
      else expect(body).not.toHaveProperty('expectedArchiveSha256');
      expect(new Headers(init?.headers).get('X-MBFD-CSRF')).toMatch(/^csrf_/);
      expect(host.textContent).toContain('Source published for Mock and Real bids.');
    },
  );

  it('blocks double-click publication synchronously and supports an already-published response', async () => {
    const pending = deferred<Response>();
    const source = archive();
    const defaultFetch = defaultImplementation();
    fetcher.mockImplementation((url, init) =>
      String(url) === '/api/admin/bid-forms' ? pending.promise : defaultFetch(url, init),
    );
    await render();
    await open();
    await select(source);
    await act(async () => {
      const publish = button('Publish source');
      publish.click();
      publish.click();
    });
    await waitFor(() => publicationRequests().length === 1);
    expect(publicationRequests()).toHaveLength(1);
    await act(async () =>
      pending.resolve(
        reply({
          year: YEAR,
          sha256: await bidFormArchiveHash(source),
          publishedAt: PUBLISHED_AT,
          alreadyPublished: true,
        }),
      ),
    );
    expect(host.textContent).toContain('This source is already published.');
  });

  it('retains the selected file after conflict and requires a successful metadata reload before retry', async () => {
    const defaultFetch = defaultImplementation();
    let conflict = true;
    fetcher.mockImplementation((url, init) => {
      if (String(url) === '/api/admin/bid-forms' && conflict)
        return Promise.resolve(reply({ error: 'source_changed' }, 409));
      if (String(url).endsWith('/source'))
        return Promise.resolve(
          reply(metadata('PUBLISHED', conflict ? CURRENT_SHA : 'd'.repeat(64))),
        );
      return defaultFetch(url, init);
    });
    await render();
    await open();
    await select();
    await act(async () => button('Publish source').click());
    await waitFor(() => host.querySelector('[role="alert"]') !== null);
    expect(host.textContent).toContain('reviewed.json · 1 forms');
    expect(host.textContent).toContain('Reload source before publishing again.');
    expect(button('Publish source').disabled).toBe(true);
    conflict = false;
    await act(async () => button('Reload source').click());
    expect(button('Publish source').disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await act(async () => button('Publish source').click());
    expect(JSON.parse(String(publicationRequests()[1]?.[1]?.body)).expectedArchiveSha256).toBe(
      'd'.repeat(64),
    );
  });

  it('ignores stale reads from the old year and aborts them', async () => {
    const pending = deferred<Response>();
    fetcher.mockImplementation((url) =>
      String(url).includes('/2026/')
        ? pending.promise
        : Promise.resolve(reply(metadata('NONE', CURRENT_SHA, 2027))),
    );
    await render();
    await open();
    const firstSignal = fetcher.mock.calls[0]?.[1]?.signal;
    await render(2027);
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => pending.resolve(reply(metadata())));
    expect(host.textContent).toContain('No source published yet.');
    expect(host.textContent).not.toContain('Prior source.xlsx');
    expect(publicationRequests()).toHaveLength(0);
  });

  it.each(['wrong-year', 'wrong-hash', 'corrupt'] as const)(
    'does not claim success from an unverified %s publication response',
    async (kind) => {
      const defaultFetch = defaultImplementation();
      const correctHash = await bidFormArchiveHash(archive());
      fetcher.mockImplementation((url, init) =>
        String(url) === '/api/admin/bid-forms'
          ? Promise.resolve(
              reply(
                kind === 'corrupt'
                  ? {}
                  : {
                      year: kind === 'wrong-year' ? 2027 : YEAR,
                      sha256: kind === 'wrong-hash' ? '0'.repeat(64) : correctHash,
                      publishedAt: PUBLISHED_AT,
                      alreadyPublished: false,
                    },
              ),
            )
          : defaultFetch(url, init),
      );
      await render();
      await open();
      await select();
      await act(async () => button('Publish source').click());
      expect(host.textContent).not.toContain('Source published for Mock and Real bids.');
      expect(host.textContent).toContain('The publication could not be verified.');
      expect(button('Publish source').disabled).toBe(true);
    },
  );

  it('discards a file read that completes after the selected year changes', async () => {
    const pending = deferred<string>();
    const file = new File(['pending'], 'old-year.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => pending.promise });
    const defaultFetch = defaultImplementation();
    fetcher.mockImplementation((url, init) =>
      String(url).includes('/2027/')
        ? Promise.resolve(reply(metadata('NONE', CURRENT_SHA, 2027)))
        : defaultFetch(url, init),
    );
    await render();
    await open();
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Missing file selector');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await render(2027);
    await act(async () => pending.resolve(JSON.stringify(archive())));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(host.textContent).not.toContain('old-year.json');
    expect(button('Publish source').disabled).toBe(true);
    expect(publicationRequests()).toHaveLength(0);
  });

  it('aborts a publication when the year changes without showing its old receipt in the new year', async () => {
    const pending = deferred<Response>();
    const source = archive();
    const sourceHash = await bidFormArchiveHash(source);
    const defaultFetch = defaultImplementation();
    fetcher.mockImplementation((url, init) => {
      if (String(url) === '/api/admin/bid-forms') return pending.promise;
      if (String(url).includes('/2027/'))
        return Promise.resolve(reply(metadata('NONE', CURRENT_SHA, 2027)));
      return defaultFetch(url, init);
    });
    await render();
    await open();
    await select(source);
    await act(async () => button('Publish source').click());
    await waitFor(() => publicationRequests().length === 1);
    const signal = publicationRequests()[0]?.[1]?.signal;
    await render(2027);
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      pending.resolve(
        reply({
          year: YEAR,
          sha256: sourceHash,
          publishedAt: PUBLISHED_AT,
          alreadyPublished: false,
        }),
      ),
    );
    expect(host.textContent).toContain('No source published yet.');
    expect(host.textContent).not.toContain('Source published for Mock and Real bids.');
    expect(button('Publish source').disabled).toBe(true);
  });

  it('checks the complete UTF-8 publication body limit, including the expected hash', async () => {
    const source = archive();
    source.forms = [];
    const rows = Array.from({ length: 1000 }, (_, index) => ({
      employeeId: `synthetic-${index}`,
      sourceMemberName: 'Member Test',
      sourceRank: 'CPT',
      bidOrder: null,
      values: { a: '', b: '', c: '' },
      provenance: [
        { page: 1, textLine: index + 1, bbox: [1, 2, 3, 4] as [number, number, number, number] },
      ],
    }));
    source.rankLists = [
      {
        listId: 'SYNTHETIC',
        title: 'Synthetic',
        source: { name: 'Synthetic.pdf', sha256: 'f'.repeat(64), pages: 1, generatedAt: [] },
        columns: ['a', 'b', 'c'],
        columnLabels: { a: 'A', b: 'B', c: 'C' },
        rows,
      },
    ];
    let remaining = 1_048_560 - new TextEncoder().encode(JSON.stringify(source)).byteLength;
    for (const row of rows) {
      for (const column of ['a', 'b', 'c'] as const) {
        const length = Math.min(300, remaining);
        row.values[column] = 'x'.repeat(length);
        remaining -= length;
      }
    }
    expect(remaining).toBe(0);
    await render();
    await open();
    await select(source);
    expect(button('Publish source').disabled).toBe(false);
    await act(async () => button('Publish source').click());
    expect(host.textContent).toContain('The publication exceeds 1 MiB.');
    expect(publicationRequests()).toHaveLength(0);
  });
});

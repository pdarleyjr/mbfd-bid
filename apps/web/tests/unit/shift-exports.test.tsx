// @vitest-environment jsdom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportCard } from '../../app/admin/exports/_components/ExportCard';
import { ExportTriggerButton } from '../../app/admin/exports/_components/ExportTriggerButton';
import { ShiftExportMenu, ShiftExports } from '../../app/admin/exports/_components/ShiftExports';

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/components/admin/TaskPanel', () => ({
  TaskPanel: ({
    open,
    onClose,
    children,
  }: { open: boolean; onClose(): void; children: ReactNode }) =>
    open ? (
      <dialog open>
        <button type="button" onClick={onClose}>
          Close panel
        </button>
        {children}
      </dialog>
    ) : null,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let host: HTMLDivElement;
let files: Array<{ name: string; href: string }>;
const createObjectUrl = vi.fn(() => 'blob:synthetic-export');
const revokeObjectUrl = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  navigation.refresh.mockReset();
  files = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectUrl, configurable: true });
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    files.push({ name: this.download, href: this.href });
  });
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(children: ReactNode) {
  await act(() => root.render(children));
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}
function selectField(label: string): HTMLSelectElement {
  const field = document.querySelector(`select[aria-label="${label}"]`);
  if (!(field instanceof HTMLSelectElement)) throw new Error(`Missing ${label}`);
  return field;
}
async function select(label: string, value: string) {
  const field = selectField(label);
  await act(() => {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function fileResponse(format: 'pdf' | 'xlsx', name = `mbfd-mock-bid-2026-all-seq-4.${format}`) {
  return new Response(format === 'pdf' ? '%PDF-1.7 synthetic' : 'PK synthetic workbook', {
    headers: {
      'content-type':
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${name}"`,
    },
  });
}

describe('current session shift downloads', () => {
  it.each(
    ['A', 'B', 'C', 'D', 'ALL'].flatMap((shift) =>
      ['pdf', 'xlsx'].flatMap((format) =>
        ['shift', 'bid'].map((view) => ({ shift, format, view })),
      ),
    ),
  )(
    'downloads $view view $shift as $format through the authenticated proxy without changing the session',
    async ({ shift, format, view }) => {
      const fileFormat = format as 'pdf' | 'xlsx';
      const fetchMock = vi.fn(async () => fileResponse(fileFormat));
      vi.stubGlobal('fetch', fetchMock);
      await mount(<ShiftExports sessionId="session / test" />);
      expect(selectField('Export view').value).toBe('shift');
      await select('Export view', view);
      await select('Export shifts', shift);
      await select('Export format', format);
      await click(`Download ${format === 'pdf' ? 'PDF' : 'Excel'}`);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `/api/admin/exports/session%20%2F%20test/shifts?shift=${shift}&format=${format}${view === 'shift' ? '&view=shift' : ''}`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      expect(files).toEqual([
        { name: `mbfd-mock-bid-2026-all-seq-4.${format}`, href: 'blob:synthetic-export' },
      ]);
      expect(host.querySelector('[role="status"]')?.textContent).toContain('download started');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await vi.advanceTimersByTimeAsync(1000);
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:synthetic-export');
    },
  );

  it('keeps the same session and shift after a PDF failure and permits Excel retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'browser_rendering_not_configured' }, { status: 503 }),
      )
      .mockResolvedValueOnce(fileResponse('xlsx'));
    vi.stubGlobal('fetch', fetchMock);
    await mount(<ShiftExports sessionId="retained-mock" initialScope="B" />);
    await click('Download PDF');
    expect(files).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'PDF export is unavailable',
    );
    expect(selectField('Export shifts').value).toBe('B');
    await select('Export format', 'xlsx');
    await click('Download Excel');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/exports/retained-mock/shifts?shift=B&format=xlsx&view=shift',
      { credentials: 'same-origin', cache: 'no-store' },
    );
    expect(files).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    {
      response: () =>
        new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
      error: 'did not return the requested file',
    },
    {
      response: () => Response.json({ error: 'missing_auth' }, { status: 401 }),
      error: 'sign-in needs attention',
    },
    {
      response: () => new Response('', { headers: { 'content-type': 'application/pdf' } }),
      error: 'exported file was empty',
    },
  ])(
    'reports a failed or invalid response without a false downloaded message',
    async ({ response, error }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response()),
      );
      await mount(<ShiftExports sessionId="same-session" />);
      await click('Download PDF');
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(error);
      expect(host.querySelector('[role="status"]')).toBeNull();
      expect(files).toHaveLength(0);
    },
  );

  it('locks the scope and format while a single export is pending', async () => {
    let finish: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await mount(<ShiftExports sessionId="pending-session" />);
    await click('Download PDF');
    expect(selectField('Export shifts').disabled).toBe(true);
    expect(selectField('Export view').disabled).toBe(true);
    expect(selectField('Export format').disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    await click('Preparing download…');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(fileResponse('pdf'));
      await Promise.resolve();
    });
    expect(files).toHaveLength(1);
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
  });
  it('permits the same download to be retried after a network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(fileResponse('pdf'));
    vi.stubGlobal('fetch', fetchMock);
    await mount(<ShiftExports sessionId="same-session" initialScope="C" />);
    await click('Download PDF');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be reached. Try again',
    );
    expect(files).toHaveLength(0);
    await click('Download PDF');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
    expect(files).toHaveLength(1);
  });

  it('opens on the current shift, carries that context to reports, and restores the button on close', async () => {
    await mount(<ShiftExportMenu sessionId="current-session" currentShift="C" />);
    await click('Export');
    expect(selectField('Export shifts').value).toBe('C');
    expect(document.querySelector('a')?.getAttribute('href')).toBe(
      '/admin/exports?session_id=current-session&shift=C',
    );
    await click('Close panel');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button'));
    await mount(<ShiftExportMenu sessionId="current-session" currentShift="D" />);
    await click('Export');
    expect(selectField('Export shifts').value).toBe('D');
  });
});

describe('archived report controls', () => {
  it('preserves a signed HTTPS archive download returned by the authenticated Worker', async () => {
    const signedUrl = 'https://exports.example/roster.pdf?signature=synthetic';
    const fetchMock = vi.fn(async () => Response.json({ url: signedUrl }));
    vi.stubGlobal('fetch', fetchMock);
    await mount(
      <ExportCard
        sessionId="signed-session"
        entry={{ r2Key: 'roster.pdf', kind: 'pdf', bytes: 100, uploadedAt: '2026-10-04T00:00:00Z' }}
      />,
    );
    await click('Get link');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/admin/exports/signed-session/roster.pdf/url',
      { credentials: 'include', cache: 'no-store' },
    );
    expect(host.querySelector('a')?.getAttribute('href')).toBe(signedUrl);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it.each([
    'javascript:alert(1)',
    'data:application/pdf,synthetic',
    'http://exports.example/roster.pdf',
    '//exports.example/roster.pdf',
    'https://user:pass@exports.example/roster.pdf',
    '/api/admin/exports/../../other-page',
  ])('rejects an unsafe archive URL %s', async (url) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ url })),
    );
    await mount(
      <ExportCard
        sessionId="same-session"
        entry={{ r2Key: 'roster.pdf', kind: 'pdf', bytes: 100, uploadedAt: '2026-10-04T00:00:00Z' }}
      />,
    );
    await click('Get link');
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'download link was invalid',
    );
  });
  it('reports a failed Get link and supports retry into the authenticated download', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ url: '/api/admin/exports/session/report/download' }));
    vi.stubGlobal('fetch', fetchMock);
    await mount(
      <ExportCard
        sessionId="session"
        entry={{ r2Key: 'report', kind: 'pdf', bytes: 100, uploadedAt: '2026-10-04T00:00:00Z' }}
      />,
    );
    await click('Get link');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('(503)');
    expect(host.querySelector('a')).toBeNull();
    await click('Get link');
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      '/api/admin/exports/session/report/download',
    );
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('refreshes the available file list only after generation succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 502 }))
        .mockResolvedValueOnce(Response.json({ r2Key: 'report' })),
    );
    await mount(<ExportTriggerButton kind="roster" shift="D" sessionId="same-session" />);
    await click('Archive Days PDF');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Failed:');
    expect(navigation.refresh).not.toHaveBeenCalled();
    await click('Archive Days PDF');
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('roster generated');
  });
});

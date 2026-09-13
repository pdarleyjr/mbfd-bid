// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AnnualRequestError } from '../../app/admin/annual-plan/annual-plan-client';
import { TargetSolutionsWorkspace } from '../../app/admin/targetsolutions/TargetSolutionsWorkspace';
import { retryImportGroup } from '../../app/admin/targetsolutions/import-retry';

const navigation = vi.hoisted(() => ({ search: 'import=retained-1', replace: vi.fn() }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('../../app/admin/annual-plan/annual-plan-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/admin/annual-plan/annual-plan-client')>()),
  annualGet: api.get,
  annualPost: api.post,
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  api.get.mockReset();
  api.post.mockReset();
  navigation.replace.mockReset();
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderImport(basePath?: string, reviewNote = 'Synthetic reviewed import') {
  navigation.search = 'source=targetsolutions&import=retained-1';
  api.get.mockImplementation(async (path: string) => {
    if (path === 'targetsolutions/imports')
      return {
        imports: [
          {
            id: 'retained-1',
            filename: 'Synthetic retained.csv',
            observed_on: '2026-09-12',
            status: 'reviewed',
          },
          {
            id: 'retained-2',
            filename: 'Synthetic second.csv',
            observed_on: '2026-09-11',
            status: 'reviewed',
          },
        ],
      };
    if (path === 'targetsolutions/catalog') return { credentials: [], mappings: [] };
    if (path.endsWith('/names')) return { names: [] };
    return {
      id: 'retained-1',
      filename: 'Synthetic retained.csv',
      observed_on: '2026-09-12',
      status: 'reviewed',
      source_row_count: 1,
      unique_row_count: 1,
      coverage: {
        expirationDates: true,
        issueDates: true,
        explicitStatus: true,
        activeOnly: false,
      },
      counts: { NEW_QUALIFICATION: 1 },
      rows: [
        {
          id: 'source-1',
          member_id: 91,
          credential_id: 13,
          applied_at: null,
          classification: 'CONFLICT',
          source: {
            employeeId: 'synthetic-91',
            firstName: 'Synthetic',
            lastName: 'Holder',
            credentialName: 'Synthetic credential',
            status: 'active',
            effectiveOn: null,
            expiresOn: null,
          },
          before: null,
        },
      ],
    };
  });
  api.post.mockResolvedValue({ processed: 1, remainingSafe: 0 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(TargetSolutionsWorkspace, basePath === undefined ? {} : { basePath }),
      ),
    ),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain('Apply reviewed records (1)');
  });
  const reason = container.querySelector<HTMLInputElement>(
    'input[placeholder="Source reviewed and reason for the updates"]',
  );
  if (!reason) throw new Error('Review note missing');
  await settle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      reason,
      reviewNote,
    );
    reason.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { container, invalidation };
}

it.each([429, 503])('recovers from temporary %s without changing the command', async (status) => {
  const command = { key: 'same-reviewed-command', safe: true };
  const sendCommand = vi
    .fn()
    .mockRejectedValueOnce(new AnnualRequestError(status, 'authorization_unavailable', 'Hub busy'))
    .mockResolvedValue({ processed: 20 });
  const wait = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const result = await retryImportGroup(
    () => sendCommand(command),
    new AbortController().signal,
    vi.fn(),
    wait,
  );
  expect(result).toEqual({ processed: 20 });
  expect(sendCommand.mock.calls).toEqual([[command], [command]]);
  expect(wait).toHaveBeenCalledTimes(1);
});

it.each([
  [401, 'step_up_required'],
  [403, 'invalid_identity'],
  [409, 'stale_review'],
  [503, 'misconfigured'],
])('never retries %s %s', async (status, code) => {
  const failure = new AnnualRequestError(Number(status), String(code), 'Review needed');
  const send = vi.fn().mockRejectedValue(failure);
  await expect(retryImportGroup(send, new AbortController().signal, vi.fn(), vi.fn())).rejects.toBe(
    failure,
  );
  expect(send).toHaveBeenCalledTimes(1);
});

it('stops during backoff without issuing another command', async () => {
  const controller = new AbortController();
  const send = vi
    .fn()
    .mockRejectedValue(new AnnualRequestError(503, 'authorization_unavailable', 'Hub busy'));
  const retrying = retryImportGroup(send, controller.signal, () => controller.abort());
  expect(await retrying).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
});

it('bounds retries during a prolonged outage', async () => {
  const failure = new AnnualRequestError(503, 'authorization_unavailable', 'Hub unavailable');
  const send = vi.fn().mockRejectedValue(failure);
  const wait = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  await expect(retryImportGroup(send, new AbortController().signal, vi.fn(), wait)).rejects.toBe(
    failure,
  );
  expect(send).toHaveBeenCalledTimes(6);
  expect(wait.mock.calls.map((call) => call[0])).toEqual([5000, 10000, 20000, 40000, 60000]);
});

it.each([undefined, '/admin/department/import?source=targetsolutions&import=old'])(
  'keeps resume and member history links in the selected import workspace %s',
  async (basePath) => {
    const { container } = await renderImport(basePath);
    const resume = [...container.querySelectorAll('select')].find(
      (select) => select.value === 'retained-1',
    );
    if (!resume) throw new Error('Resume import selector missing');
    await settle(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
        resume,
        'retained-2',
      );
      resume.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(navigation.replace).toHaveBeenLastCalledWith(
      basePath
        ? '/admin/department/import?source=targetsolutions&import=retained-2'
        : '/admin/targetsolutions?import=retained-2',
    );
    expect(container.querySelector('a[href*="memberId=91"]')?.getAttribute('href')).toBe(
      basePath ? '/admin/department?memberId=91' : '/admin/personnel/qualifications?memberId=91',
    );
    await settle(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(resume, '');
      resume.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(navigation.replace).toHaveBeenLastCalledWith(
      basePath ? '/admin/department/import?source=targetsolutions' : '/admin/targetsolutions',
    );
  },
);

it('retains the Department source selector after uploading and comparing a new import', async () => {
  const { container } = await renderImport('/admin/department/import?source=targetsolutions');
  api.post.mockResolvedValueOnce({ id: 'uploaded-1' });
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error('Import file input missing');
  const source = new File(
    ['employee_id,credential\nsynthetic-91,Synthetic credential'],
    'Synthetic upload.csv',
    { type: 'text/csv' },
  );
  Object.defineProperty(source, 'text', {
    value: async () => 'employee_id,credential\nsynthetic-91,Synthetic credential',
  });
  await settle(() => {
    Object.defineProperty(fileInput, 'files', { value: [source] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(() =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Upload and compare')
      ?.click(),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(navigation.replace).toHaveBeenCalledWith(
      '/admin/department/import?source=targetsolutions&import=uploaded-1',
    );
    expect(api.post).toHaveBeenCalledWith(
      'targetsolutions/imports/uploaded-1/review',
      { accept: true },
      expect.any(String),
    );
  });
});

it('refreshes Department after successful TargetSolutions apply and preserves source/import on auth return', async () => {
  const { container, invalidation } = await renderImport(
    '/admin/department/import?source=targetsolutions',
  );
  const apply = [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.startsWith('Apply reviewed records'),
  );
  if (!apply) throw new Error('Apply reviewed records missing');
  await settle(() => apply.click());
  await vi.waitFor(async () => {
    await settle();
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['admin', 'department'] });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['targetsolutions'] });
  });
  api.post.mockRejectedValueOnce(
    new AnnualRequestError(401, 'step_up_required', 'Fresh sign-in required'),
  );
  await settle(() => apply.click());
  await vi.waitFor(async () => {
    await settle();
    const href = container.querySelector('a[href^="/api/auth/start"]')?.getAttribute('href');
    expect(href).toBe(
      `/api/auth/start?returnTo=${encodeURIComponent('/admin/department/import?source=targetsolutions&import=retained-1')}`,
    );
  });
});

function sourceSwitch() {
  const link = document.createElement('a');
  link.href = '/admin/department/import?source=telestaff';
  link.textContent = 'Import TeleStaff';
  document.body.appendChild(link);
  const followed = vi.fn((event: Event) => event.preventDefault());
  link.addEventListener('click', followed);
  return { link, followed };
}

it('allows a clean retained import to switch sources without an unsaved-change warning', async () => {
  await renderImport('/admin/department/import?source=targetsolutions', '');
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { link, followed } = sourceSwitch();
  await settle(() =>
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
  expect(confirmation).not.toHaveBeenCalled();
  expect(followed).toHaveBeenCalledOnce();
});

it('protects review notes and pending apply across source navigation, then honors approved departure cleanup', async () => {
  const { container } = await renderImport('/admin/department/import?source=targetsolutions');
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { link, followed } = sourceSwitch();
  await settle(() =>
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
  expect(confirmation).toHaveBeenCalled();
  expect(followed).not.toHaveBeenCalled();
  expect(
    container.querySelector<HTMLInputElement>(
      'input[placeholder="Source reviewed and reason for the updates"]',
    )?.value,
  ).toBe('Synthetic reviewed import');
  let finish: ((result: { processed: number; remainingSafe: number }) => void) | undefined;
  api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const apply = [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.startsWith('Apply reviewed records'),
  );
  if (!apply) throw new Error('Apply action missing');
  await settle(() => apply.click());
  await settle(() =>
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
  expect(followed).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Stop after current group');
  confirmation.mockReturnValue(true);
  await settle(() =>
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
  expect(followed).toHaveBeenCalledOnce();
  act(() => root?.unmount());
  root = undefined;
  await settle(() => finish?.({ processed: 1, remainingSafe: 1 }));
  expect(api.post).toHaveBeenCalledOnce();
});

it('protects an unuploaded file and preserves the warning for a missing apply receipt', async () => {
  const { container } = await renderImport('/admin/department/import?source=targetsolutions', '');
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { link, followed } = sourceSwitch();
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!fileInput) throw new Error('Import file input missing');
  await settle(() => {
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['synthetic'], 'Synthetic unsaved.csv')],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(() =>
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
  expect(followed).not.toHaveBeenCalled();
  expect(confirmation).toHaveBeenCalled();
  const note = container.querySelector<HTMLInputElement>(
    'input[placeholder="Source reviewed and reason for the updates"]',
  );
  if (!note) throw new Error('Review note missing');
  await settle(() => {
    Object.defineProperty(fileInput, 'files', { value: [], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      note,
      'Synthetic reviewed import',
    );
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
  api.post.mockRejectedValueOnce(new TypeError('Synthetic lost response'));
  await settle(() =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.startsWith('Apply reviewed records'))
      ?.click(),
  );
  await vi.waitFor(async () => {
    await settle();
    expect(container.textContent).toContain('Synthetic lost response');
  });
  await settle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(note, '');
    note.dispatchEvent(new Event('input', { bubbles: true }));
  });
  confirmation.mockClear();
  await settle(() =>
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  );
  expect(confirmation).toHaveBeenCalled();
  expect(followed).not.toHaveBeenCalled();
});

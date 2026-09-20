// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminQueryProvider } from '../../app/admin/_components/AdminQueryProvider';
import {
  TeleStaffOperatorWorkspace as TeleStaffComponent,
  UnknownEmployeeOnboardingPanel,
  teleStaffErrorCopy,
} from '../../app/admin/telestaff/TeleStaffOperatorWorkspace';
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
function TeleStaffOperatorWorkspace() {
  return (
    <AdminQueryProvider>
      <TeleStaffComponent />
    </AdminQueryProvider>
  );
}

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderWorkspace(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(<TeleStaffOperatorWorkspace />);
  });
  return container;
}

describe('TeleStaff operator error guidance', () => {
  it('explains recoverable canonical drift without exposing internal error syntax', () => {
    expect(teleStaffErrorCopy('canonical_state_changed')).toContain(
      'Exact prior TeleStaff matches are preserved automatically',
    );
    expect(teleStaffErrorCopy('terminal_reconciliation_required')).toContain(
      'zero pending rows and zero hard blockers',
    );
  });
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(control: HTMLElement): Promise<void> {
  await act(async () => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setValue(
  control: HTMLInputElement | HTMLSelectElement,
  value: string,
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(
    control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
    'value',
  );
  descriptor?.set?.call(control, value);
  await act(async () => {
    control.dispatchEvent(new Event('change', { bubbles: true }));
    control.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

function requiredControl(
  container: HTMLElement,
  selector: string,
): HTMLInputElement | HTMLSelectElement {
  const control = container.querySelector(selector);
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) {
    throw new Error(`Required test control did not render: ${selector}`);
  }
  return control;
}

describe('TeleStaffOperatorWorkspace', () => {
  it('guards entered source and effective dates while allowing clean retained views and downloads', async () => {
    const importSummary = {
      id: 'synthetic-clean-import',
      status: 'reviewed',
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-09-12',
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      reconciliationRevision: 3,
      normalizedDataRowCount: 1,
      uniqueEmployeeCount: 1,
      reconciliation: {
        sourceRows: 1,
        pendingSourceRows: 0,
        hardBlockerSourceRows: 0,
        incompleteTopologySourceRows: 0,
        missingObservationFindings: 0,
        pendingMissingObservationFindings: 0,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('?limit=25')
          ? Response.json({ imports: [importSummary] })
          : Response.json({
              import: importSummary,
              rows: [],
              missingObservationFindings: [],
              pagination: { totalRows: 1 },
            }),
      ),
    );
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const container = renderWorkspace();
    await settle();
    const link = document.createElement('a');
    link.href = '/admin/department/import?source=targetsolutions';
    document.body.appendChild(link);
    const followed = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', followed);
    const attempt = () =>
      act(() => {
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    attempt();
    expect(confirmation).not.toHaveBeenCalled();
    expect(followed).toHaveBeenCalledOnce();
    const saved = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Snapshot 2026-09-12'),
    );
    if (!saved) throw new Error('Saved import missing');
    await click(saved);
    attempt();
    expect(confirmation).not.toHaveBeenCalled();
    expect(followed).toHaveBeenCalledTimes(2);
    await setValue(requiredControl(container, 'select[name="source_kind"]'), 'official');
    attempt();
    expect(confirmation).toHaveBeenCalled();
    expect(followed).toHaveBeenCalledTimes(2);
    link.setAttribute('download', '');
    attempt();
    expect(followed).toHaveBeenCalledTimes(3);
    link.removeAttribute('download');
    await setValue(requiredControl(container, 'select[name="source_kind"]'), '');
    confirmation.mockClear();
    await setValue(
      requiredControl(container, 'section[aria-labelledby="telestaff-apply-heading"] input'),
      '2026-09-12',
    );
    attempt();
    expect(confirmation).toHaveBeenCalled();
    expect(followed).toHaveBeenCalledTimes(3);
    confirmation.mockReturnValue(true);
    attempt();
    expect(followed).toHaveBeenCalledTimes(4);
  });

  it('refreshes Department and existing staffing views after successful canonical apply', async () => {
    const invalidation = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const importSummary = {
      id: 'synthetic-department-apply',
      status: 'reviewed',
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-09-12',
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      reconciliationRevision: 3,
      normalizedDataRowCount: 1,
      uniqueEmployeeCount: 1,
      reconciliation: {
        sourceRows: 1,
        pendingSourceRows: 0,
        hardBlockerSourceRows: 0,
        incompleteTopologySourceRows: 0,
        missingObservationFindings: 0,
        pendingMissingObservationFindings: 0,
      },
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/admin/telestaff/imports?limit=25')
        return Response.json({ imports: [importSummary] });
      if (path.endsWith('/apply')) return Response.json({ applied: 1 });
      return Response.json({
        import: importSummary,
        rows: [],
        missingObservationFindings: [],
        pagination: { totalRows: 1 },
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const container = renderWorkspace();
    await settle();
    const saved = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Snapshot 2026-09-12'),
    );
    if (!saved) throw new Error('Saved import missing');
    await click(saved);
    await setValue(
      requiredControl(container, 'section[aria-labelledby="telestaff-apply-heading"] input'),
      '2026-09-12',
    );
    const apply = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Apply to Department staffing',
    );
    if (!apply) throw new Error('Canonical apply control missing');
    await click(apply);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/telestaff/imports/synthetic-department-apply/apply',
      expect.any(Object),
    );
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['admin', 'department'] });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['admin', 'current-roster'] });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('creates reviewed unknown employees through personnel lifecycle then re-reconciles once', async () => {
    const completed = vi.fn();
    const failed = vi.fn();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = String(input);
        if (url === '/api/auth/csrf') {
          return new Response(
            JSON.stringify({ token: 'csrf_123e4567-e89b-12d3-a456-426614174000' }),
            { status: 200 },
          );
        }
        if (url === '/api/admin/personnel/changes') {
          return new Response(JSON.stringify({ replayed: false, event: { kind: 'NEW_HIRE' } }), {
            status: 201,
          });
        }
        if (url === '/api/admin/telestaff/imports/import-unknown/reconcile') {
          return new Response(
            JSON.stringify({ import: { id: 'import-unknown' }, reconciliation: {} }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <UnknownEmployeeOnboardingPanel
          importId="import-unknown"
          expectedRevision={7}
          employees={[
            {
              rowId: 'row-1',
              sourceRowNumber: 4,
              sourceEmployeeId: 'E-1234',
              sourceDisplayName: 'Source Person',
            },
          ]}
          busy={false}
          onComplete={completed}
          onError={failed}
        />,
      );
    });

    expect(container.textContent).toContain('Source Person');
    expect(container.textContent).toContain('E-1234');
    expect(container.textContent).toContain('not saved in the import history');
    await setValue(requiredControl(container, '[name="first_name-row-1"]'), 'Canonical');
    await setValue(requiredControl(container, '[name="last_name-row-1"]'), 'Member');
    await setValue(requiredControl(container, '[name="rank-row-1"]'), 'FF');
    await setValue(requiredControl(container, '[name="bid_category-row-1"]'), 'FF');
    await setValue(requiredControl(container, '[name="rsc_seniority-row-1"]'), '42');
    await setValue(requiredControl(container, '[name="effective_on-row-1"]'), '2026-09-03');

    const submit = container.querySelector<HTMLButtonElement>(
      '[data-testid="telestaff-onboard-unknown-submit"]',
    );
    if (!submit) throw new Error('Unknown employee onboarding submit did not render.');
    await click(submit);

    const personnelCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/admin/personnel/changes',
    );
    expect(JSON.parse(String(personnelCall?.[1]?.body))).toMatchObject({
      kind: 'NEW_HIRE',
      new_member: {
        employee_id: 'E-1234',
        first_name: 'Canonical',
        last_name: 'Member',
        rank: 'FF',
        bid_category: 'FF',
        rsc_seniority: 42,
      },
      effective_on: '2026-09-03',
    });
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === '/api/admin/telestaff/imports/import-unknown/reconcile',
      ),
    ).toHaveLength(1);
    expect(completed).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });

  it('creates a reviewed civilian without requiring fire rank or seniority', async () => {
    const completed = vi.fn();
    const failed = vi.fn();
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = String(input);
        if (url === '/api/auth/csrf') {
          return new Response(
            JSON.stringify({ token: 'csrf_123e4567-e89b-12d3-a456-426614174000' }),
            { status: 200 },
          );
        }
        if (url === '/api/admin/personnel/changes') {
          return new Response(JSON.stringify({ replayed: false, event: { kind: 'NEW_HIRE' } }), {
            status: 201,
          });
        }
        if (url === '/api/admin/telestaff/imports/import-civilian/reconcile') {
          return new Response(JSON.stringify({ import: { id: 'import-civilian' } }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(
        <UnknownEmployeeOnboardingPanel
          importId="import-civilian"
          expectedRevision={8}
          employees={[
            {
              rowId: 'row-civilian',
              sourceRowNumber: 16,
              sourceEmployeeId: '17951',
              sourceDisplayName: 'ARMSTRONG, TOMAS',
            },
          ]}
          busy={false}
          onComplete={completed}
          onError={failed}
        />,
      );
    });

    await setValue(requiredControl(container, '[name="first_name-row-civilian"]'), 'Tomas');
    await setValue(requiredControl(container, '[name="last_name-row-civilian"]'), 'Armstrong');
    await setValue(requiredControl(container, '[name="rank-row-civilian"]'), 'CIVILIAN');
    await setValue(requiredControl(container, '[name="effective_on-row-civilian"]'), '2026-09-04');
    const submit = container.querySelector<HTMLButtonElement>(
      '[data-testid="telestaff-onboard-unknown-submit"]',
    );
    if (!submit) throw new Error('Unknown employee onboarding submit did not render.');
    await click(submit);

    const personnelCall = fetchMock.mock.calls.find(
      ([input]) => String(input) === '/api/admin/personnel/changes',
    );
    expect(JSON.parse(String(personnelCall?.[1]?.body))).toMatchObject({
      kind: 'NEW_HIRE',
      new_member: {
        employee_id: '17951',
        first_name: 'Tomas',
        last_name: 'Armstrong',
        rank: null,
        bid_category: 'EXCLUDED',
      },
      effective_on: '2026-09-04',
    });
    expect(JSON.parse(String(personnelCall?.[1]?.body)).new_member).not.toHaveProperty(
      'rsc_seniority',
    );
    expect(completed).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });

  it('requires a deliberate source-kind declaration before an HTML preview', () => {
    const markup = renderToStaticMarkup(<TeleStaffOperatorWorkspace />);

    expect(markup).toContain('Report date');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept="text/html,.html,.htm"');
    expect(markup).toContain('Preview staffing changes');
    expect(markup).toContain('data-testid="telestaff-preview-form"');
    expect(markup).toContain('Report type');
    expect(markup).toContain('name="source_kind"');
    expect(markup).toContain('value="official"');
    expect(markup).toContain('value="synthetic_test"');
    expect(markup).toContain('Select the report type');
    expect(markup).toContain(
      'The import history does not retain the original HTML, names, or employee IDs',
    );
    expect(markup).toContain('Exact report time');
    expect(markup).toContain('source_observed_at');
    expect(markup).toContain('date_only');
    expect(markup).toContain('source_metadata');
    expect(markup).toContain('administrator_confirmed');
    expect(markup).toContain('<option value="source_metadata">Time supplied in report</option>');
    expect(markup).toContain(
      '<option value="administrator_confirmed">Time confirmed by administrator</option>',
    );
    expect(markup).toContain('Review TeleStaff staffing');
    expect(markup).not.toContain('idempotent acceptance receipt');
  });

  it('keeps canonical application unavailable until a reviewed import is loaded', () => {
    const markup = renderToStaticMarkup(<TeleStaffOperatorWorkspace />);

    expect(markup).toContain('Apply to Department staffing');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Assignment effective date');
  });

  it("offers the selected import's sanitized reconciliation CSV download only after it is loaded", async () => {
    const importSummary = {
      id: 'import-safe-1',
      status: 'reviewed',
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-08-28',
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      reconciliationRevision: 3,
      normalizedDataRowCount: 2,
      uniqueEmployeeCount: 2,
      reconciliation: {
        sourceRows: 2,
        pendingSourceRows: 0,
        hardBlockerSourceRows: 0,
        incompleteTopologySourceRows: 0,
        missingObservationFindings: 0,
        pendingMissingObservationFindings: 0,
      },
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url === '/api/admin/telestaff/imports?limit=25') {
        return new Response(JSON.stringify({ imports: [importSummary] }), { status: 200 });
      }
      if (url === '/api/admin/telestaff/imports/import-safe-1') {
        return new Response(
          JSON.stringify({
            import: importSummary,
            rows: [],
            missingObservationFindings: [],
            pagination: { totalRows: 2 },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = renderWorkspace();
    await settle();
    const selectImport = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Snapshot 2026-08-28'),
    );
    if (!selectImport) throw new Error('Retained TeleStaff import control did not render.');
    expect(selectImport.textContent).toContain('Official source');

    await click(selectImport);

    const exportLink = container.querySelector<HTMLAnchorElement>(
      '[data-testid="telestaff-reconciliation-export"]',
    );
    expect(exportLink?.textContent).toContain('Download review summary (CSV)');
    expect(exportLink?.getAttribute('href')).toBe(
      '/api/admin/telestaff/imports/import-safe-1/reconciliation.csv',
    );
    expect(exportLink?.hasAttribute('download')).toBe(true);
    expect(container.querySelector('[data-testid="telestaff-next-steps"]')?.textContent).toContain(
      'Recommended order',
    );
  });

  it('lets operators navigate every reconciliation page', async () => {
    const importSummary = {
      id: 'import-paged-1',
      status: 'reviewed',
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-08-28',
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      reconciliationRevision: 5,
      normalizedDataRowCount: 262,
      uniqueEmployeeCount: 262,
      reconciliation: {
        sourceRows: 262,
        pendingSourceRows: 8,
        hardBlockerSourceRows: 8,
        incompleteTopologySourceRows: 0,
        missingObservationFindings: 0,
        pendingMissingObservationFindings: 0,
      },
    };
    const detail = {
      import: importSummary,
      rows: [],
      missingObservationFindings: [],
      pagination: { totalRows: 262 },
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url === '/api/admin/telestaff/imports?limit=25') {
        return new Response(JSON.stringify({ imports: [importSummary] }), { status: 200 });
      }
      if (
        url === '/api/admin/telestaff/imports/import-paged-1' ||
        url === '/api/admin/telestaff/imports/import-paged-1?limit=100&offset=100'
      ) {
        return new Response(JSON.stringify(detail), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const container = renderWorkspace();
    await settle();
    const importButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Snapshot 2026-08-28'),
    );
    if (!importButton) throw new Error('Retained import control did not render.');
    await click(importButton);

    expect(container.querySelector('[data-testid="telestaff-page-status"]')?.textContent).toContain(
      'Page 1 of 3',
    );
    const next = container.querySelector<HTMLButtonElement>('[data-testid="telestaff-next-page"]');
    if (!next) throw new Error('Next page control did not render.');
    await click(next);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/telestaff/imports/import-paged-1?limit=100&offset=100',
      expect.any(Object),
    );
    expect(container.querySelector('[data-testid="telestaff-page-status"]')?.textContent).toContain(
      'Page 2 of 3',
    );
  });

  it('reports when safe exception resolution has nothing eligible to change', async () => {
    const importSummary = {
      id: 'import-safe-noop',
      status: 'reviewed',
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-08-28',
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      reconciliationRevision: 9,
      normalizedDataRowCount: 2,
      uniqueEmployeeCount: 2,
      reconciliation: {
        sourceRows: 2,
        pendingSourceRows: 2,
        hardBlockerSourceRows: 0,
        incompleteTopologySourceRows: 0,
        missingObservationFindings: 0,
        pendingMissingObservationFindings: 0,
      },
    };
    const detail = {
      import: importSummary,
      rows: [],
      missingObservationFindings: [],
      pagination: { totalRows: 2 },
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = String(input);
        if (url === '/api/admin/telestaff/imports?limit=25') {
          return new Response(JSON.stringify({ imports: [importSummary] }), { status: 200 });
        }
        if (url === '/api/admin/telestaff/imports/import-safe-noop') {
          return new Response(JSON.stringify(detail), { status: 200 });
        }
        if (url === '/api/auth/csrf') {
          return new Response(
            JSON.stringify({ token: 'csrf_123e4567-e89b-12d3-a456-426614174000' }),
            { status: 200 },
          );
        }
        if (url.endsWith('/resolve-safe-exceptions')) {
          return new Response(
            JSON.stringify({
              counts: {
                deferredRepeatedTopology: 0,
                retainedIncompleteTopology: 0,
                rejectedUnknownPerson: 0,
                rejectedAmbiguousMapping: 0,
              },
              idempotent: true,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const container = renderWorkspace();
    await settle();
    const importButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Snapshot 2026-08-28'),
    );
    if (!importButton) throw new Error('Retained import control did not render.');
    await click(importButton);
    const resolveButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Resolve test-environment exceptions'),
    );
    if (!resolveButton) throw new Error('Safe resolution control did not render.');
    await click(resolveButton);

    expect(container.textContent).toContain('No eligible exceptions remained');
    expect(container.textContent).not.toContain(
      'Exception review decisions were saved; Department staffing was not changed.',
    );
  });

  it('uses the same-origin CSRF path to certify and renders the structured result', async () => {
    const importSummary = {
      id: 'import-certify-1',
      status: 'reviewed',
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-08-24',
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      reconciliationRevision: 12,
      normalizedDataRowCount: 219,
      uniqueEmployeeCount: 213,
      reconciliation: {
        sourceRows: 219,
        pendingSourceRows: 219,
        hardBlockerSourceRows: 0,
        incompleteTopologySourceRows: 0,
        missingObservationFindings: 0,
        pendingMissingObservationFindings: 0,
      },
    };
    const detail = {
      import: importSummary,
      rows: [],
      missingObservationFindings: [],
      pagination: { totalRows: 219 },
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = String(input);
        if (url === '/api/admin/telestaff/imports?limit=25') {
          return new Response(JSON.stringify({ imports: [importSummary] }), { status: 200 });
        }
        if (url === '/api/admin/telestaff/imports/import-certify-1') {
          return new Response(JSON.stringify(detail), { status: 200 });
        }
        if (url === '/api/auth/csrf') {
          return new Response(
            JSON.stringify({ token: 'csrf_123e4567-e89b-12d3-a456-426614174000' }),
            {
              status: 200,
            },
          );
        }
        if (url.endsWith('/certify-deterministic-staffing')) {
          return new Response(
            JSON.stringify({
              certification: {
                requestedCertifications: 213,
                createdCanonicalStaffingPositions: 213,
                createdSourceMappings: 213,
                existingIdempotentMatches: 0,
                unresolvedObservations: 6,
                skippedCollisions: 0,
                failures: [],
                idempotent: false,
              },
            }),
            { status: 201 },
          );
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const container = renderWorkspace();
    await settle();
    const importButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Snapshot 2026-08-24'),
    );
    if (!importButton) throw new Error('Retained import control did not render.');
    await click(importButton);

    const certifyButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="telestaff-certify-deterministic"]',
    );
    expect(certifyButton?.textContent).toContain('Confirm clearly identified positions');
    expect(container.textContent).toContain('report clearly identifies each seat');

    if (!certifyButton) throw new Error('Certification control did not render.');
    await click(certifyButton);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/telestaff/imports/import-certify-1/certify-deterministic-staffing',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ get: expect.any(Function) }),
      }),
    );
    expect(
      (
        fetchMock.mock.calls.find(([input]) =>
          String(input).endsWith('/certify-deterministic-staffing'),
        )?.[1]?.headers as Headers
      ).get('X-MBFD-CSRF'),
    ).toBe('csrf_123e4567-e89b-12d3-a456-426614174000');
    expect(
      container.querySelector('[data-testid="telestaff-certification-result"]')?.textContent,
    ).toContain('213');
    expect(container.textContent).toContain('Unresolved observations');
  });

  it('reviews safe deterministic observations beyond the visible import page', async () => {
    const importSummary = {
      id: 'import-review-all-1',
      status: 'reviewed',
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-08-28',
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      reconciliationRevision: 55,
      normalizedDataRowCount: 262,
      uniqueEmployeeCount: 262,
      reconciliation: {
        sourceRows: 262,
        pendingSourceRows: 211,
        hardBlockerSourceRows: 0,
        incompleteTopologySourceRows: 11,
        missingObservationFindings: 0,
        pendingMissingObservationFindings: 0,
      },
    };
    const detail = {
      import: importSummary,
      rows: [],
      missingObservationFindings: [],
      pagination: { totalRows: 262 },
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = String(input);
        if (url === '/api/admin/telestaff/imports?limit=25') {
          return new Response(JSON.stringify({ imports: [importSummary] }), { status: 200 });
        }
        if (url === '/api/admin/telestaff/imports/import-review-all-1') {
          return new Response(JSON.stringify(detail), { status: 200 });
        }
        if (url === '/api/auth/csrf') {
          return new Response(
            JSON.stringify({ token: 'csrf_123e4567-e89b-12d3-a456-426614174000' }),
            { status: 200 },
          );
        }
        if (url.endsWith('/review-deterministic-observations')) {
          return new Response(JSON.stringify({ acceptedObservations: 211, idempotent: false }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    const container = renderWorkspace();
    await settle();
    const importButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Snapshot 2026-08-28'),
    );
    if (!importButton) throw new Error('Retained import control did not render.');
    await click(importButton);

    const reviewButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="telestaff-review-deterministic"]',
    );
    if (!reviewButton) throw new Error('Deterministic review control did not render.');
    await click(reviewButton);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/telestaff/imports/import-review-all-1/review-deterministic-observations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ get: expect.any(Function) }),
      }),
    );
    expect(
      container.querySelector('[data-testid="telestaff-deterministic-review-result"]')?.textContent,
    ).toContain('211');
  });

  it('uses the authenticated CSRF path to designate a committed import as the 2026 staffing baseline', async () => {
    const importSummary = {
      id: 'import-baseline-2026',
      status: 'committed',
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-08-24',
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      reconciliationRevision: 786,
      normalizedDataRowCount: 262,
      uniqueEmployeeCount: 211,
      reconciliation: {
        sourceRows: 262,
        pendingSourceRows: 0,
        hardBlockerSourceRows: 0,
        incompleteTopologySourceRows: 0,
        missingObservationFindings: 0,
        pendingMissingObservationFindings: 0,
      },
    };
    const detail = {
      import: importSummary,
      rows: [],
      missingObservationFindings: [],
      pagination: { totalRows: 262 },
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = String(input);
        if (url === '/api/admin/telestaff/imports?limit=25') {
          return new Response(JSON.stringify({ imports: [importSummary] }), { status: 200 });
        }
        if (url === '/api/admin/telestaff/imports/import-baseline-2026') {
          return new Response(JSON.stringify(detail), { status: 200 });
        }
        if (url === '/api/auth/csrf') {
          return new Response(
            JSON.stringify({ token: 'csrf_123e4567-e89b-12d3-a456-426614174000' }),
            {
              status: 200,
            },
          );
        }
        if (url.endsWith('/baseline-acceptance')) {
          return new Response(
            JSON.stringify({
              acceptanceId: 'baseline-acceptance-2026-import-baseline-2026',
              importId: importSummary.id,
              idempotent: false,
              supersededAcceptanceId: 'previous-baseline-acceptance',
              baseline: { status: 'PASS' },
            }),
            { status: 201 },
          );
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    const container = renderWorkspace();
    await settle();
    const importButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Snapshot 2026-08-24'),
    );
    if (!importButton) throw new Error('Retained import control did not render.');
    await click(importButton);

    const baselineButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="telestaff-baseline-acceptance"]',
    );
    expect(baselineButton?.textContent).toContain('Designate 2026 staffing baseline');
    expect(baselineButton?.disabled).toBe(false);
    if (!baselineButton) throw new Error('Baseline acceptance control did not render.');
    await click(baselineButton);
    expect(baselineButton.textContent).toContain('Confirm 2026 staffing baseline');
    expect(container.textContent).toContain(
      'This saves the selected import as this year’s production staffing baseline and replaces',
    );
    expect(
      fetchMock.mock.calls.find(([input]) => String(input).endsWith('/baseline-acceptance')),
    ).toBeUndefined();
    await click(baselineButton);

    const baselineCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/baseline-acceptance'),
    );
    expect(baselineCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ get: expect.any(Function) }),
      }),
    );
    const headers = baselineCall?.[1]?.headers as Headers;
    expect(headers.get('X-MBFD-CSRF')).toBe('csrf_123e4567-e89b-12d3-a456-426614174000');
    expect(headers.get('Idempotency-Key')).toBe('baseline-acceptance-2026-import-baseline-2026');
    expect(JSON.parse(String(baselineCall?.[1]?.body))).toMatchObject({
      bid_year: 2026,
      supersede_existing: true,
    });
    expect(
      container.querySelector('[data-testid="telestaff-baseline-result"]')?.textContent,
    ).toContain('PASS');
  });
});

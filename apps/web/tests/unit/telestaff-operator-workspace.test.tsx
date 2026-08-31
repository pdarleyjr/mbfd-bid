// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TeleStaffOperatorWorkspace } from '../../app/admin/telestaff/TeleStaffOperatorWorkspace';

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

describe('TeleStaffOperatorWorkspace', () => {
  it('requires a deliberate source-kind declaration before an HTML preview', () => {
    const markup = renderToStaticMarkup(<TeleStaffOperatorWorkspace />);

    expect(markup).toContain('Source snapshot as of');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept="text/html,.html,.htm"');
    expect(markup).toContain('Preview sanitized reconciliation');
    expect(markup).toContain('data-testid="telestaff-preview-form"');
    expect(markup).toContain('Source kind declaration');
    expect(markup).toContain('name="source_kind"');
    expect(markup).toContain('value="official"');
    expect(markup).toContain('value="synthetic_test"');
    expect(markup).toContain('Select the source declaration');
    expect(markup).toContain('No raw HTML, names, or employee IDs are retained');
    expect(markup).toContain('Exact source observation time');
    expect(markup).toContain('source_observed_at');
    expect(markup).toContain('date_only');
    expect(markup).toContain('source_metadata');
    expect(markup).toContain('administrator_confirmed');
  });

  it('keeps canonical application unavailable until a reviewed import is loaded', () => {
    const markup = renderToStaticMarkup(<TeleStaffOperatorWorkspace />);

    expect(markup).toContain('Apply to canonical staffing');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('canonical effective date');
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
    expect(exportLink?.textContent).toContain('Download sanitized reconciliation CSV');
    expect(exportLink?.getAttribute('href')).toBe(
      '/api/admin/telestaff/imports/import-safe-1/reconciliation.csv',
    );
    expect(exportLink?.hasAttribute('download')).toBe(true);
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
    expect(certifyButton?.textContent).toContain('Certify deterministic staffing positions');
    expect(container.textContent).toContain('213 unique complete source tuples');

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

  it('uses the authenticated CSRF path to designate a committed import as the 2026 staging baseline', async () => {
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
    expect(baselineButton?.textContent).toContain('Designate 2026 staging baseline');
    expect(baselineButton?.disabled).toBe(false);
    if (!baselineButton) throw new Error('Baseline acceptance control did not render.');
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
    expect(
      container.querySelector('[data-testid="telestaff-baseline-result"]')?.textContent,
    ).toContain('PASS');
  });
});

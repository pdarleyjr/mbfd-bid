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
});

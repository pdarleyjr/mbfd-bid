// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinalPortalPublicationControls } from '../../app/admin/exports/_components/FinalPortalPublicationControls';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root;
let container: HTMLDivElement;
const fetcher = vi.fn();
beforeEach(async () => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<FinalPortalPublicationControls sessionId="synthetic-real" />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
async function upload() {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    value: [{ size: 12, text: async () => JSON.stringify({ expected_sequence: 123, rows: [] }) }],
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
}
async function preview(enabled: boolean) {
  fetcher.mockResolvedValueOnce(
    Response.json({
      source_sequence: 123,
      source_result_hash: 'a'.repeat(64),
      manifest_sha256: 'b'.repeat(64),
      confirmation_phrase: 'PUBLISH FINAL exact phrase',
      publication_enabled: enabled,
      counts: { bid_award: 218, retained_nonbiddable: 8, total: 226, hub_matched: 226 },
      metadata_overrides: [
        {
          position_id: 'B703',
          before: 'Lieutenant #3 (R)',
          after: 'Firefighter #1',
          reason: 'Reviewed final workbook.',
        },
      ],
    }),
  );
  await upload();
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent === 'Preview final assignments',
  );
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
}
describe('final Portal Sync workflow', () => {
  it('shows an exact preview while disabled and prevents publication', async () => {
    await preview(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      '218 awards · 8 retained assignments · 226 matched employees',
    );
    expect(container.textContent).toContain('Lieutenant #3 (R) → Firefighter #1');
    expect(container.textContent).toContain('Preview completed without changes.');
    const publish = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Publish 226 final assignments',
    );
    expect(publish?.disabled).toBe(true);
  });
  it('blocks an unreconciled or Mock source without offering publication', async () => {
    fetcher.mockResolvedValueOnce(
      Response.json(
        { error: 'final_reconciliation_required', issues: ['mock_session_not_transitionable'] },
        { status: 409 },
      ),
    );
    await upload();
    await act(async () => {
      container.querySelector('button')?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('mock_session_not_transitionable');
    expect(container.querySelector('[data-testid=final-publication-preview]')).toBeNull();
  });
  it('requires exact administrator confirmation after a successful enabled preview', async () => {
    await preview(true);
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === 'Publish 226 final assignments',
    );
    expect(button?.disabled).toBe(true);
    const input = container.querySelector('input[autocomplete=off]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, 'PUBLISH FINAL exact phrase');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button?.disabled).toBe(false);
    fetcher.mockResolvedValueOnce(Response.json({ ok: true }));
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(fetcher.mock.calls[1]?.[0]).toContain('/synthetic-real/publish');
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body).confirmation_phrase).toBe(
      'PUBLISH FINAL exact phrase',
    );
    expect(container.textContent).toContain('Final assignments are queued.');
  });
});

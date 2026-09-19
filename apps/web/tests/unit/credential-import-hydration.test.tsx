// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { CredentialImportWorkspace } from '../../app/admin/credentials/import/CredentialImportWorkspace';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('disables the server-rendered import until hydration, then handles layout and selected file', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/csrf') {
      return Response.json({ token: 'csrf_11111111-1111-1111-1111-111111111111' });
    }
    return Response.json({
      previewKey: 'synthetic',
      sourceHash: 'synthetic',
      sourceRevision: 1,
      ready: false,
      rows: [],
      errors: [],
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const tree = (
    <QueryClientProvider client={new QueryClient()}>
      <CredentialImportWorkspace />
    </QueryClientProvider>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(tree);
  document.body.appendChild(container);
  const file = container.querySelector<HTMLInputElement>('input[type="file"]');
  const layout = container.querySelector('select');
  const form = container.querySelector('form');
  if (!file || !layout || !form) throw new Error('Import controls missing');
  expect(file.matches(':disabled')).toBe(true);
  expect(layout.matches(':disabled')).toBe(true);
  expect(form.querySelector('button')?.matches(':disabled')).toBe(true);

  await act(async () => {
    root = hydrateRoot(container, tree);
  });
  expect(file.matches(':disabled')).toBe(false);
  await act(async () => {
    layout.value = 'legacy_wide_matrix';
    layout.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(container.textContent).toContain('Leading metadata columns');
  const workbook = new File(['synthetic'], 'synthetic.xlsx');
  await act(async () => {
    Object.defineProperty(file, 'files', { value: [workbook], configurable: true });
    file.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  const preview = fetcher.mock.calls.find(([input]) => String(input).endsWith('/preview'));
  expect(preview).toBeDefined();
  expect(container.textContent).toContain('Review proposed changes');
});

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CredentialsCatalogWorkspace } from '../../app/admin/credentials/CredentialsCatalogWorkspace';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await settle(() => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('CredentialsCatalogWorkspace', () => {
  it('separates editable catalog defaults from effective-dated qualification evidence', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <CredentialsCatalogWorkspace
          initialCredentials={[
            { id: 13, name: 'Synthetic Credential', fyPointsDefault: 0, holderCount: 2 },
          ]}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('Credentials &amp; Specialty Points');
    expect(html).toContain('Add credential');
    expect(html).toContain('Default points');
    expect(html).toContain('Referenced members');
    expect(html).toContain('Record qualification evidence');
    expect(html).toContain('these defaults do not rewrite any frozen annual Bid score');
    expect(html).toContain('Display-name changes preserve the stable credential identity');
  });

  it('shows Department definitions and evidence links without displaying Bid point controls', () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <CredentialsCatalogWorkspace
          departmentMode
          initialCredentials={[
            { id: 13, name: 'Synthetic Credential', fyPointsDefault: 37, holderCount: 2 },
          ]}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('Credential definitions');
    expect(html).toContain('Annual Bid values are managed separately');
    expect(html).toContain('href="/admin/department"');
    expect(html.toLowerCase()).not.toContain('default points');
  });

  it.each([true, false])(
    'preserves hidden stored point values when editing=%s and links holders to Department',
    async (editing) => {
      const credential = {
        id: 13,
        name: 'Synthetic Credential',
        fyPointsDefault: 37,
        holderCount: 1,
        revision: 2,
      };
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/auth/csrf')
          return Response.json({ token: 'csrf_123e4567-e89b-12d3-a456-426614174000' });
        if (path.endsWith('/dependencies'))
          return Response.json({ retirementBlocked: false, policyReferences: [] });
        if (path.endsWith('/holders'))
          return Response.json({
            holders: [
              {
                memberId: 91,
                employeeId: 'synthetic-91',
                firstName: 'Synthetic',
                lastName: 'Holder',
                historyHref: '/admin/personnel/qualifications?memberId=91',
                legacyReference: true,
              },
            ],
          });
        if (init?.method === 'PATCH' || init?.method === 'POST')
          return Response.json({ credential });
        return Response.json({ credentials: [credential], total: 1 });
      });
      vi.stubGlobal('fetch', fetcher);
      const container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await settle(() =>
        root?.render(
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            <CredentialsCatalogWorkspace departmentMode initialCredentials={[credential]} />
          </QueryClientProvider>,
        ),
      );
      await settle(() =>
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === 'View members')
          ?.click(),
      );
      await vi.waitFor(async () => {
        await settle();
        expect(document.querySelector('a[href="/admin/department?memberId=91"]')).not.toBeNull();
      });
      await settle(() =>
        document.querySelector<HTMLButtonElement>('button[aria-label="Close panel"]')?.click(),
      );
      await settle(() =>
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === (editing ? 'Edit' : 'Add credential'))
          ?.click(),
      );
      const name = [...document.querySelectorAll('label')]
        .find((label) => label.textContent?.includes('Credential name'))
        ?.querySelector('input');
      const reason = document.querySelector('textarea');
      if (!name || !reason) throw new Error('Credential edit fields missing');
      expect(document.querySelector('input[type="number"]')).toBeNull();
      await setValue(name, 'Reviewed synthetic credential');
      await setValue(reason, 'Synthetic reviewed definition');
      await settle(() =>
        document
          .querySelector('form')
          ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
      );
      const write = fetcher.mock.calls.find(
        ([input, init]) =>
          String(input).startsWith('/api/admin/credentials') &&
          init?.method === (editing ? 'PATCH' : 'POST'),
      );
      expect(write).toBeDefined();
      expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
        fy_points_default: editing ? 37 : 0,
      });
    },
  );
});

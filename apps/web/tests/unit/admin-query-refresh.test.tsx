// @vitest-environment jsdom
import { focusManager, onlineManager, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ claims: { sub: 901, member_id: 901, security_version: 1 } }));
vi.mock('@/lib/require-admin', () => ({ requireAdmin: async () => auth.claims }));
vi.mock('@/components/BrandHeader', () => ({ BrandHeader: () => null }));
vi.mock('@/components/LogoutButton', () => ({ LogoutButton: () => null }));
vi.mock('../../app/admin/_components/AdminLayoutShell', () => ({
  AdminLayoutShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../app/admin/_components/StepUpProvider', () => ({
  StepUpProvider: ({ children }: { children: React.ReactNode }) => children,
}));
import { AdminQueryProvider } from '../../app/admin/_components/AdminQueryProvider';
import { CredentialsCatalogWorkspace } from '../../app/admin/credentials/CredentialsCatalogWorkspace';
import AdminLayout from '../../app/admin/layout';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const settle = async (action: () => void) => {
  act(action);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const rendered = async (check: () => void) => {
  await vi.waitFor(async () => {
    await settle(() => {});
    check();
  });
};
it('refreshes stale catalog data on focus and reconnect without replacing unsaved fields', async () => {
  const first = { id: 1, name: 'Original credential', fyPointsDefault: 0, holderCount: 0 };
  let revision = 1;
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          credentials: [{ ...first, name: `Reviewed credential ${revision}`, revision }],
          total: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <AdminQueryProvider>
        <CredentialsCatalogWorkspace initialCredentials={[first]} />
      </AdminQueryProvider>,
    ),
  );
  const name = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.includes('Credential name'))
    ?.querySelector('input');
  if (!name) throw new Error('Credential name input missing');
  await settle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      name,
      'Unsaved proposed credential',
    );
    name.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
  await settle(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await rendered(() => expect(container.textContent).toContain('Reviewed credential 1'));
  expect(name.value).toBe('Unsaved proposed credential');
  revision = 2;
  clock.mockReturnValue(now + 62_000);
  await settle(() => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await rendered(() => expect(container.textContent).toContain('Reviewed credential 2'));
  expect(name.value).toBe('Unsaved proposed credential');
});

it.each(['identity', 'security version'])(
  'does not expose the previous cache after the authenticated %s changes',
  async (change) => {
    auth.claims = { sub: 901, member_id: 901, security_version: 1 };
    let identity = 'operator-one';
    let resolveSecond: ((value: string) => void) | undefined;
    const query = vi.fn(() =>
      identity === 'operator-one'
        ? Promise.resolve('First operator private data')
        : new Promise<string>((resolve) => {
            resolveSecond = resolve;
          }),
    );
    function PrivatePanel() {
      const result = useQuery({ queryKey: ['admin', 'private-data'], queryFn: query });
      return <output>{result.data ?? 'Loading current identity'}</output>;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const firstLayout = await AdminLayout({ children: <PrivatePanel /> });
    await settle(() => root?.render(firstLayout));
    await rendered(() => expect(container.textContent).toBe('First operator private data'));
    identity = 'operator-two';
    auth.claims =
      change === 'identity'
        ? { sub: 902, member_id: 902, security_version: 1 }
        : { sub: 901, member_id: 901, security_version: 2 };
    const nextLayout = await AdminLayout({ children: <PrivatePanel /> });
    await settle(() => root?.render(nextLayout));
    expect(container.textContent).toBe('Loading current identity');
    expect(container.textContent).not.toContain('First operator');
    await settle(() => resolveSecond?.('Second operator private data'));
    await rendered(() => expect(container.textContent).toBe('Second operator private data'));
  },
);

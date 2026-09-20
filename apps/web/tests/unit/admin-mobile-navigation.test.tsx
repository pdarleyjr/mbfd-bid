// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/components/admin/BidYearContext', () => ({ BidYearContext: () => null }));
const route = vi.hoisted(() => ({ pathname: '/admin/personnel', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/components/admin/AdminShell', () => ({
  AdminSideNav: () => (
    <nav aria-label="Admin navigation">
      <a href="/admin/current-rosters" onClick={(event) => event.preventDefault()}>
        Current Rosters
      </a>
      <a href="/admin/personnel?view=history" onClick={(event) => event.preventDefault()}>
        History
      </a>
      <a href="/admin/personnel" onClick={(event) => event.preventDefault()}>
        Current page
      </a>
    </nav>
  ),
}));

import { AdminLayoutShell } from '../../app/admin/_components/AdminLayoutShell';
import { useUnsavedChanges } from '../../lib/use-unsaved-changes';

const roots: Root[] = [];

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});

beforeEach(() => {
  route.pathname = '/admin/personnel';
  route.search = '';
  window.history.replaceState(null, '', route.pathname);
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function DraftGuard() {
  useUnsavedChanges(true);
  return null;
}

function renderShell(dirty = false): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <AdminLayoutShell>
        <h1>Admin content</h1>
        <button type="button" data-testid="workspace-action">
          Edit Bid
        </button>
        {dirty && <DraftGuard />}
      </AdminLayoutShell>,
    );
  });
  return container;
}

async function click(control: HTMLElement, options: MouseEventInit = {}): Promise<void> {
  await act(async () => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function mobileLink(href: string): HTMLAnchorElement {
  const link = document.querySelector<HTMLAnchorElement>(
    `#admin-mobile-navigation a[href="${href}"]`,
  );
  if (!link) throw new Error(`Missing mobile link: ${href}`);
  return link;
}

async function openNavigation(container: HTMLElement): Promise<HTMLButtonElement> {
  const toggle = container.querySelector<HTMLButtonElement>(
    '[data-testid="admin-mobile-nav-toggle"]',
  );
  if (!toggle) throw new Error('Missing navigation toggle');
  await click(toggle);
  return toggle;
}

async function commitRoute(pathname: string, search = '') {
  route.pathname = pathname;
  route.search = search;
  window.history.replaceState(null, '', `${pathname}${search ? `?${search}` : ''}`);
  await act(async () => {
    roots[0]?.render(
      <AdminLayoutShell>
        <h1>Committed destination</h1>
        <button type="button" data-testid="workspace-action">
          Edit Bid
        </button>
      </AdminLayoutShell>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  // Flush the committed route's focus frame before starting the next interaction.
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe('AdminLayoutShell mobile navigation', () => {
  it.each(['route', 'same URL'])(
    'does not steal workspace focus on later query changes after a %s close',
    async (closeType) => {
      const container = renderShell();
      await openNavigation(container);
      if (closeType === 'route') {
        await click(mobileLink('/admin/current-rosters'));
        await commitRoute('/admin/current-rosters');
      } else {
        await click(mobileLink('/admin/personnel'));
      }
      expect(document.querySelector('#admin-mobile-navigation')).toBeNull();
      expect(document.activeElement).toBe(container.querySelector('main'));
      const action = container.querySelector<HTMLButtonElement>('[data-testid="workspace-action"]');
      if (!action) throw new Error('Workspace action missing');
      action.focus();
      await commitRoute(route.pathname, 'view=edit');
      expect(action.isConnected).toBe(true);
      expect(document.activeElement).toBe(action);
      await commitRoute(route.pathname, 'view=history');
      expect(document.activeElement).toBe(action);
    },
  );

  it.each([
    ['/admin/current-rosters', '/admin/current-rosters', ''],
    ['/admin/personnel?view=history', '/admin/personnel', 'view=history'],
  ])(
    'keeps %s mounted until its route commits, then focuses the content',
    async (href, pathname, search) => {
      const container = renderShell();
      const toggle = await openNavigation(container);
      const link = mobileLink(href);
      await click(link);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(link.isConnected).toBe(true);
      expect(
        document.querySelector('#admin-mobile-navigation')?.contains(document.activeElement),
      ).toBe(true);
      await commitRoute(pathname, search);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.querySelector('#admin-mobile-navigation')).toBeNull();
      expect(document.activeElement).toBe(container.querySelector('main'));
    },
  );

  it('closes an exact same-URL selection immediately and focuses the content', async () => {
    const container = renderShell();
    const toggle = await openNavigation(container);
    await click(mobileLink('/admin/personnel'));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(container.querySelector('main'));
  });

  it('preserves a rejected unsaved-change navigation and Escape returns focus to the toggle', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const container = renderShell(true);
    const toggle = await openNavigation(container);
    const link = mobileLink('/admin/current-rosters');
    await click(link);
    expect(confirm).toHaveBeenCalledOnce();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(link.isConnected).toBe(true);
    expect(window.location.pathname).toBe('/admin/personnel');
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('leaves the menu open for modified, non-left, separate-target, download and external clicks', async () => {
    const container = renderShell();
    const toggle = await openNavigation(container);
    const link = mobileLink('/admin/personnel');
    for (const options of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      await click(link, options);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    }
    for (const target of ['_blank', 'another-window']) {
      link.target = target;
      await click(link);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    }
    link.removeAttribute('target');
    link.setAttribute('download', 'file');
    await click(link);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    link.removeAttribute('download');
    link.href = 'https://example.test/admin/personnel';
    await click(link);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('provides a collapsed, accessible navigation replacement below the md breakpoint', async () => {
    const container = renderShell();
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mobile-nav-toggle"]',
    );
    if (!toggle) throw new Error('Mobile admin navigation toggle did not render.');

    expect(toggle.getAttribute('aria-controls')).toBe('admin-mobile-navigation');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    // A closed dialog must not eagerly insert a portal during page hydration.
    expect(document.querySelector('#admin-mobile-navigation')).toBeNull();

    await click(toggle);

    const mobileNavigation = document.querySelector<HTMLElement>('#admin-mobile-navigation');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(mobileNavigation?.hidden).toBe(false);
    expect(mobileNavigation?.className).toContain('md:hidden');
    expect(mobileNavigation?.querySelector('nav[aria-label="Admin navigation"]')).not.toBeNull();
    expect(mobileNavigation?.textContent).toContain('Current Rosters');
    expect(document.activeElement).toBe(mobileNavigation?.querySelector('a'));
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    await click(toggle);
    route.pathname = '/admin/current-rosters';
    await act(async () => {
      roots[0]?.render(
        <AdminLayoutShell>
          <h1>Current Rosters</h1>
        </AdminLayoutShell>,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.querySelector('#admin-mobile-navigation')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('main'));
  });
});

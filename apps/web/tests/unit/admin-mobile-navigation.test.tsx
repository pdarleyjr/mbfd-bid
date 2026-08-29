// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/admin/AdminShell', () => ({
  AdminSideNav: () => (
    <nav aria-label="Admin navigation">
      <a href="/admin/current-rosters">Current Rosters</a>
    </nav>
  ),
}));

import { AdminLayoutShell } from '../../app/admin/_components/AdminLayoutShell';

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
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function renderShell(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <AdminLayoutShell>
        <h1>Admin content</h1>
      </AdminLayoutShell>,
    );
  });
  return container;
}

async function click(control: HTMLButtonElement): Promise<void> {
  await act(async () => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

describe('AdminLayoutShell mobile navigation', () => {
  it('provides a collapsed, accessible navigation replacement below the md breakpoint', async () => {
    const container = renderShell();
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-mobile-nav-toggle"]',
    );
    if (!toggle) throw new Error('Mobile admin navigation toggle did not render.');

    expect(toggle.getAttribute('aria-controls')).toBe('admin-mobile-navigation');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    const mobileNavigation = container.querySelector<HTMLElement>('#admin-mobile-navigation');
    expect(mobileNavigation?.hidden).toBe(true);
    expect(mobileNavigation?.className).toContain('md:hidden');

    await click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(mobileNavigation?.hidden).toBe(false);
    expect(mobileNavigation?.className).toContain('md:hidden');
    expect(mobileNavigation?.querySelector('nav[aria-label="Admin navigation"]')).not.toBeNull();
    expect(mobileNavigation?.textContent).toContain('Current Rosters');
  });
});

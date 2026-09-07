'use client';

import { AdminSideNav } from '@/components/admin/AdminShell';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'mbfd-admin-sidebar-collapsed';

/**
 * Client wrapper around the admin sidebar + main content split. Owns the
 * collapsed state so the chief can pin the sidebar away on the live bid
 * console (where every extra px of grid matters) and have that choice
 * survive page navigation. Persisted in localStorage so a reload keeps it.
 */
export function AdminLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const mobileNavigation = useRef<HTMLDivElement>(null);
  const mainContent = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setMobileNavOpen(false);
    if (mobileNavOpen) mainContent.current?.focus();
  }, [pathname, mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    mobileNavigation.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus();
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMobileNavOpen(false);
      mobileToggle.current?.focus();
    };
    const selected = (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        !mobileNavigation.current?.contains(link) ||
        link.target === '_blank'
      )
        return;
      // Unsaved-edit rejection stops propagation before this listener. Next
      // Link prevents the default browser load even when navigation is accepted.
      setMobileNavOpen(false);
      mainContent.current?.focus();
    };
    document.addEventListener('keydown', dismissOnEscape);
    document.addEventListener('click', selected);
    return () => {
      document.removeEventListener('keydown', dismissOnEscape);
      document.removeEventListener('click', selected);
    };
  }, [mobileNavOpen]);

  // Read the persisted preference on mount. Two-phase render avoids the SSR
  // mismatch warning (server emits "expanded", client may have a stored
  // "collapsed" preference).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      // localStorage can throw under private-browsing; default to expanded.
    }
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore — preference simply won't persist
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col md:flex-row">
      <aside
        data-testid="admin-sidebar"
        data-collapsed={hydrated ? collapsed : false}
        className={[
          'hidden shrink-0 border-r border-slate-700 transition-[width] duration-fast ease-out-quart md:block',
          collapsed && hydrated ? 'w-16' : 'w-60',
        ].join(' ')}
      >
        <div className="flex h-9 items-center justify-end border-b border-slate-700 px-1">
          <button
            type="button"
            data-testid="admin-sidebar-toggle"
            onClick={toggle}
            aria-pressed={collapsed}
            aria-label={collapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}
            className="rounded p-1 text-sm font-bold text-slate-300 hover:bg-slate-700 hover:text-white"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
        <AdminSideNav compact={collapsed && hydrated} />
      </aside>

      <div className="min-w-0 flex-1">
        <div className="border-b border-slate-700 bg-slate-900 px-4 py-2 md:hidden">
          <button
            type="button"
            data-testid="admin-mobile-nav-toggle"
            ref={mobileToggle}
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-controls="admin-mobile-navigation"
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? 'Close admin navigation' : 'Open admin navigation'}
            className="inline-flex min-h-11 items-center rounded-md border border-slate-600 px-3 text-sm font-semibold text-slate-100 hover:border-slate-400 hover:bg-slate-800"
          >
            Navigation
          </button>
        </div>
        <div
          id="admin-mobile-navigation"
          ref={mobileNavigation}
          hidden={!mobileNavOpen}
          className="border-b border-slate-700 bg-slate-900 md:hidden"
        >
          <AdminSideNav />
        </div>
        <main ref={mainContent} tabIndex={-1} className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

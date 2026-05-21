'use client';

import { AdminSideNav } from '@/components/admin/AdminShell';
import { type ReactNode, useEffect, useState } from 'react';

const STORAGE_KEY = 'mbfd-admin-sidebar-collapsed';

/**
 * Client wrapper around the admin sidebar + main content split. Owns the
 * collapsed state so the chief can pin the sidebar away on the live bid
 * console (where every extra px of grid matters) and have that choice
 * survive page navigation. Persisted in localStorage so a reload keeps it.
 */
export function AdminLayoutShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState(false);

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
    <div className="flex min-h-[calc(100vh-57px)]">
      <aside
        data-testid="admin-sidebar"
        data-collapsed={hydrated ? collapsed : false}
        className={[
          'hidden shrink-0 border-r border-slate-700 transition-[width] duration-fast ease-out-quart md:block',
          collapsed && hydrated ? 'w-10' : 'w-52',
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
        {!collapsed && <AdminSideNav />}
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

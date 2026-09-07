'use client';

import { MBFD_MASTER_LOGO_PATH } from '@/components/BrandHeader';
import { LogoutButton } from '@/components/LogoutButton';
import { AdminSideNav } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/button';
import { Dialog } from '@base-ui/react/dialog';
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'mbfd-admin-sidebar-collapsed';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      data-testid="brand-header"
      className="flex min-h-20 items-center gap-3 border-b border-sidebar-border px-4 py-3 text-sidebar-foreground"
    >
      <img
        src={MBFD_MASTER_LOGO_PATH}
        alt="Miami Beach Fire Department"
        width={44}
        height={44}
        className="h-11 w-11 shrink-0 object-contain"
      />
      {!compact && (
        <div className="min-w-0">
          <p className="font-heading text-sm font-bold">MBFD Annual Bid</p>
          <p className="mt-1 text-xs text-sidebar-muted">Admin Console</p>
        </div>
      )}
    </div>
  );
}

export function AdminLayoutShell({
  children,
  userName,
}: { children: ReactNode; userName?: string }) {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const mobileNavigation = useRef<HTMLDivElement>(null);
  const mainContent = useRef<HTMLElement>(null);
  const navigationAccepted = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (mobileNavOpen) {
      navigationAccepted.current = true;
      setMobileNavOpen(false);
    }
    if (navigationAccepted.current) {
      // Closing the sheet schedules another effect. Do not cancel this one-shot
      // handoff during that state change; it belongs to the accepted new route.
      requestAnimationFrame(() => {
        mainContent.current?.focus();
        navigationAccepted.current = false;
      });
    }
  }, [pathname, mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const selected = (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        !mobileNavigation.current?.contains(link) ||
        link.target === '_blank'
      )
        return;
      // Rejected unsaved-edit navigation stops propagation before this listener.
      navigationAccepted.current = true;
      setMobileNavOpen(false);
    };
    document.addEventListener('click', selected);
    return () => document.removeEventListener('click', selected);
  }, [mobileNavOpen]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === '1') setCollapsed(true);
    } catch {
      /* Preference is optional. */
    }
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* Preference is optional. */
      }
      return next;
    });
  }
  const compact = collapsed && hydrated;
  return (
    <div className="flex min-h-screen">
      <aside
        data-testid="admin-sidebar"
        data-collapsed={compact}
        className={`hidden shrink-0 border-r border-sidebar-border bg-sidebar md:block ${compact ? 'w-20' : 'w-64'}`}
      >
        <div className="sticky top-0 flex max-h-screen flex-col">
          <Brand compact={compact} />
          <div className="flex justify-end px-3 py-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-testid="admin-sidebar-toggle"
              onClick={toggle}
              aria-pressed={collapsed}
              aria-label={collapsed ? 'Expand admin sidebar' : 'Collapse admin sidebar'}
              className="text-sidebar-muted hover:bg-sidebar-accent hover:text-white"
            >
              {compact ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </Button>
          </div>
          <div className={compact ? '' : 'min-h-0 overflow-y-auto'}>
            <AdminSideNav compact={compact} />
          </div>
          {!compact && (
            <footer className="mx-6 mb-6 mt-8 border-t border-sidebar-border pt-5 text-center text-[10px] uppercase tracking-[0.18em] text-sidebar-muted">
              <span className="mx-auto mb-4 block h-px w-12 bg-brand-gold" />
              Service · People · Community
            </footer>
          )}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex min-h-20 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              ref={mobileToggle}
              data-testid="admin-mobile-nav-toggle"
              onClick={() => {
                navigationAccepted.current = false;
                setMobileNavOpen(true);
              }}
              aria-controls="admin-mobile-navigation"
              aria-expanded={mobileNavOpen}
              aria-label="Open admin navigation"
              size="icon"
              className="md:hidden"
            >
              <Menu size={20} />
            </Button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Miami Beach Fire Department
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Annual Bid · Control Center</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {userName && (
              <p className="hidden text-right text-xs text-muted-foreground sm:block">
                Signed in as
                <br />
                <span className="text-sm font-semibold text-foreground">{userName}</span>
              </p>
            )}
            <LogoutButton />
          </div>
        </header>

        <main
          ref={mainContent}
          tabIndex={-1}
          className="admin-content min-w-0 px-4 py-6 outline-none sm:px-6 lg:px-8"
        >
          <Suspense fallback={<p className="text-muted-foreground">Loading workspace…</p>}>
            {children}
          </Suspense>
        </main>
        <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-sidebar/50 data-[closed]:hidden md:hidden" />
            <Dialog.Popup
              id="admin-mobile-navigation"
              ref={mobileNavigation}
              hidden={!mobileNavOpen}
              className="fixed inset-y-0 left-0 z-50 w-[min(20rem,calc(100%-3rem))] overflow-y-auto bg-sidebar text-sidebar-foreground outline-none md:hidden"
              initialFocus={() =>
                mobileNavigation.current?.querySelector<HTMLAnchorElement>('a[href]') ?? true
              }
              finalFocus={() =>
                navigationAccepted.current ? mainContent.current : mobileToggle.current
              }
            >
              <Dialog.Title className="sr-only">Admin navigation</Dialog.Title>
              <Brand />
              <Dialog.Close
                aria-label="Close admin navigation"
                className="ml-auto mr-3 mt-2 flex h-11 w-11 items-center justify-center rounded-md hover:bg-sidebar-accent"
              >
                <X size={20} />
              </Dialog.Close>
              <AdminSideNav />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}

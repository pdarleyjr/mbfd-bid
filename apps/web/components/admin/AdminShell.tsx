'use client';

import {
  BookOpen,
  Building2,
  CalendarCheck,
  ChevronDown,
  ClipboardList,
  FlaskConical,
  Gavel,
  LayoutDashboard,
  ListChecks,
  Network,
  Radio,
  Settings,
  UserCog,
  Users,
  UsersRound,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

type AdminSubNavLink = { href: string; label: string };

export type AdminNavLink = {
  href: string;
  label: string;
  exact: boolean;
  activePrefixes?: readonly string[];
  subnav?: readonly AdminSubNavLink[];
};

/**
 * The year-round control-center IA intentionally describes work areas rather
 * than exposing a flat list of historical implementation screens. A label is
 * not a readiness claim: unavailable areas route to an explicit blocked state.
 */
export const ADMIN_NAV_LINKS: readonly AdminNavLink[] = [
  { href: '/admin', label: 'Today', exact: true },
  {
    href: '/admin/department',
    label: 'Department',
    exact: false,
    activePrefixes: [
      '/admin/members',
      '/admin/credentials',
      '/admin/personnel',
      '/admin/targetsolutions',
      '/admin/current-rosters',
      '/admin/staffing-structure',
      '/admin/organization',
      '/admin/telestaff',
    ],
    subnav: [
      { href: '/admin/department', label: 'People' },
      { href: '/admin/department/roster', label: 'Roster & organization' },
      { href: '/admin/department/credentials', label: 'Credentials' },
      { href: '/admin/department/import', label: 'Import data' },
    ],
  },
  {
    href: '/admin/current-bid',
    label: 'Bid',
    exact: false,
    activePrefixes: [
      '/admin/annual-plan',
      '/admin/annual-policy',
      '/admin/source-review',
      '/admin/bid-setup',
      '/admin/rule-books',
      '/admin/positions',
      '/admin/rules',
      '/admin/eligibility',
      '/admin/sessions',
      '/admin/rehearsal',
      '/admin/bid',
      '/admin/bid-board',
      '/admin/specialty-adjudication',
    ],
    subnav: [
      { href: '/admin/current-bid', label: 'Edit Bid' },
      { href: '/admin/current-bid?view=blueprint', label: 'Bid Blueprint' },
      { href: '/admin/current-bid?view=mock', label: 'Mock Bid' },
      { href: '/admin/current-bid?view=live', label: 'Live Bid' },
      { href: '/admin/current-bid?view=results', label: 'Results' },
      { href: '/admin/current-bid?view=versions', label: 'Bid versions' },
    ],
  },
  {
    href: '/admin/audit',
    label: 'History',
    exact: false,
    activePrefixes: ['/admin/exports', '/admin/award-transition'],
    subnav: [
      { href: '/admin/audit', label: 'Decision history' },
      { href: '/admin/exports', label: 'Download reports' },
      { href: '/admin/award-transition', label: 'Apply reviewed final assignments' },
    ],
  },
  { href: '/admin/docs', label: 'Docs & Manual', exact: false, activePrefixes: ['/admin/guide'] },
  {
    href: '/admin/system',
    label: 'Settings',
    exact: false,
    activePrefixes: ['/admin/settings'],
    subnav: [
      { href: '/admin/system', label: 'Integrations and status' },
      { href: '/admin/settings/bid-pin', label: 'Bid access PIN' },
    ],
  },
];

function matchesPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isActive(link: AdminNavLink, pathname: string) {
  if (link.exact) return pathname === link.href;
  return [link.href, ...(link.activePrefixes ?? [])].some((prefix) =>
    matchesPath(pathname, prefix),
  );
}

const NAVIGATION_ICONS = {
  '/admin': LayoutDashboard,
  '/admin/bid-board': ClipboardList,
  '/admin/guide': BookOpen,
  '/admin/docs': BookOpen,
  '/admin/current-rosters': UsersRound,
  '/admin/staffing-structure': Building2,
  '/admin/telestaff': Network,
  '/admin/members': Users,
  '/admin/department': Users,
  '/admin/personnel': UserCog,
  '/admin/annual-plan': CalendarCheck,
  '/admin/current-bid': CalendarCheck,
  '/admin/bid-setup': ListChecks,
  '/admin/rehearsal': FlaskConical,
  '/admin/bid': Radio,
  '/admin/audit': Gavel,
  '/admin/system': Settings,
} as const;

function NavigationIcon({ href }: { href: string }) {
  const Icon = NAVIGATION_ICONS[href as keyof typeof NAVIGATION_ICONS] ?? ClipboardList;
  return <Icon aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.6} />;
}

export function AdminSideNav({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const year = search.get('year');
  const view = search.get('view') ?? 'edit';
  const contextualHref = (href: string) => {
    if (
      !href.startsWith('/admin/current-bid') ||
      !year ||
      !/^\d{4}$/.test(year) ||
      Number(year) < 2024 ||
      Number(year) > 2100
    )
      return href;
    const [path, query] = href.split('?');
    const params = new URLSearchParams(query);
    params.set('year', year);
    return `${path}?${params}`;
  };
  const activeGroup = ADMIN_NAV_LINKS.find((link) => isActive(link, pathname))?.href;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    activeGroup ? { [activeGroup]: true } : {},
  );
  useEffect(() => {
    if (activeGroup) setExpanded((current) => ({ ...current, [activeGroup]: true }));
  }, [activeGroup]);

  return (
    <nav aria-label="Admin navigation" className={`flex flex-col gap-1 ${compact ? 'p-2' : 'p-3'}`}>
      <p
        className={`${compact ? 'sr-only' : 'mb-1 px-3'} text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted`}
      >
        Control center
      </p>

      {ADMIN_NAV_LINKS.map((link) => {
        const active = isActive(link, pathname);

        return (
          <div key={link.href}>
            <div className="flex items-center">
              <Link
                href={contextualHref(link.href) as Route}
                className={[
                  'admin-navigation-link group relative flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors duration-fast ease-out-quart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                  compact ? 'justify-center px-2' : 'px-3',
                  active
                    ? 'bg-sidebar-accent text-white'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-white',
                ].join(' ')}
                aria-current={active ? 'page' : undefined}
                aria-label={compact ? link.label : undefined}
                title={compact ? link.label : undefined}
              >
                <NavigationIcon href={link.href} />
                <span
                  className={
                    compact
                      ? 'admin-navigation-label pointer-events-none absolute left-full z-30 ml-3 hidden whitespace-nowrap rounded-md border border-sidebar-border bg-sidebar px-3 py-2 text-white shadow-lg'
                      : ''
                  }
                >
                  {link.label}
                </span>
              </Link>
              {!compact && link.subnav && (
                <button
                  type="button"
                  aria-label={`${expanded[link.href] ? 'Collapse' : 'Expand'} ${link.label} menu`}
                  aria-expanded={Boolean(expanded[link.href])}
                  aria-controls={`menu-${link.label.replaceAll(' ', '-')}`}
                  onClick={() =>
                    setExpanded((current) => ({ ...current, [link.href]: !current[link.href] }))
                  }
                  className="flex size-11 shrink-0 items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-white"
                >
                  <ChevronDown
                    size={17}
                    aria-hidden="true"
                    className={expanded[link.href] ? 'rotate-180' : ''}
                  />
                </button>
              )}
            </div>

            {!compact && expanded[link.href] && link.subnav && (
              <div
                id={`menu-${link.label.replaceAll(' ', '-')}`}
                className="mt-1 ml-3 flex flex-col gap-1 border-l border-sidebar-border pl-2"
              >
                {link.subnav.map((sub) => {
                  const subActive = sub.href.startsWith('/admin/current-bid')
                    ? pathname === '/admin/current-bid' &&
                      view === (new URLSearchParams(sub.href.split('?')[1]).get('view') ?? 'edit')
                    : matchesPath(pathname, sub.href) &&
                      !link.subnav?.some(
                        (other) =>
                          other.href.length > sub.href.length && matchesPath(pathname, other.href),
                      );
                  return (
                    <Link
                      key={sub.href}
                      href={contextualHref(sub.href) as Route}
                      className={[
                        'flex min-h-11 items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-fast ease-out-quart',
                        subActive
                          ? 'bg-sidebar-accent text-white'
                          : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-white',
                      ].join(' ')}
                      aria-current={subActive ? 'page' : undefined}
                    >
                      {sub.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

'use client';

import {
  BookOpen,
  Building2,
  CalendarCheck,
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
import { usePathname } from 'next/navigation';

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
    href: '/admin/members',
    label: 'People',
    exact: false,
    activePrefixes: ['/admin/credentials', '/admin/personnel', '/admin/targetsolutions'],
    subnav: [
      { href: '/admin/members', label: 'Find a member' },
      { href: '/admin/targetsolutions', label: 'Import TargetSolutions credentials' },
      { href: '/admin/personnel/qualifications', label: 'Update qualifications' },
      { href: '/admin/credentials', label: 'Qualification catalog' },
      { href: '/admin/personnel', label: 'Employment and rank changes' },
      { href: '/admin/personnel/service-evidence', label: 'Service history' },
      { href: '/admin/personnel/tenure', label: 'Protected terms' },
      { href: '/admin/personnel/obligations', label: 'Training due after selection' },
      { href: '/admin/personnel/reviews', label: 'Qualification discrepancies' },
      { href: '/admin/personnel/operations', label: 'Year-round operations' },
    ],
  },
  {
    href: '/admin/current-rosters',
    label: 'Staffing',
    exact: false,
    activePrefixes: ['/admin/staffing-structure', '/admin/organization', '/admin/telestaff'],
    subnav: [
      { href: '/admin/current-rosters', label: 'Current assignments' },
      { href: '/admin/staffing-structure', label: 'Authorized positions and vacancies' },
      { href: '/admin/organization', label: 'Stations, shifts and pools' },
      { href: '/admin/telestaff', label: 'Import TeleStaff assignments' },
    ],
  },
  {
    href: '/admin/annual-plan',
    label: 'Annual Bid',
    exact: false,
    activePrefixes: [
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
      { href: '/admin/annual-plan', label: 'Prepare and approve setup' },
      { href: '/admin/bid-board', label: 'Bid board' },
      { href: '/admin/positions', label: 'Bid opportunities' },
      { href: '/admin/rules', label: 'Requirements and points' },
      { href: '/admin/annual-policy', label: 'Operating procedures' },
      { href: '/admin/source-review', label: 'Source decisions and changes' },
      { href: '/admin/eligibility', label: 'Check eligibility' },
      { href: '/admin/rehearsal', label: 'Practice bid' },
      { href: '/admin/bid', label: 'Run live bid' },
      { href: '/admin/bid-setup', label: 'Advanced setup' },
      { href: '/admin/rule-books', label: 'Rule versions' },
    ],
  },
  {
    href: '/admin/audit',
    label: 'History & Reports',
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
  '/admin/personnel': UserCog,
  '/admin/annual-plan': CalendarCheck,
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
            <Link
              href={link.href as Route}
              className={[
                'admin-navigation-link group relative flex min-h-[44px] items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors duration-fast ease-out-quart focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
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

            {!compact && active && link.subnav && (
              <div className="mt-1 ml-3 flex flex-col gap-1 border-l border-sidebar-border pl-2">
                {link.subnav.map((sub) => {
                  const subActive =
                    matchesPath(pathname, sub.href) &&
                    !link.subnav?.some(
                      (other) =>
                        other.href.length > sub.href.length && matchesPath(pathname, other.href),
                    );
                  return (
                    <Link
                      key={sub.href}
                      href={sub.href as Route}
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

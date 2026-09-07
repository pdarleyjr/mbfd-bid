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
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/bid-board', label: 'Bid Board', exact: false },
  { href: '/admin/guide', label: 'Administrator Guide', exact: false },
  { href: '/admin/current-rosters', label: 'Current Rosters', exact: false },
  {
    href: '/admin/staffing-structure',
    label: 'Staffing Structure',
    exact: false,
    activePrefixes: ['/admin/organization'],
    subnav: [
      { href: '/admin/staffing-structure', label: 'Authorized seats' },
      { href: '/admin/organization', label: 'Organization' },
    ],
  },
  { href: '/admin/telestaff', label: 'TeleStaff', exact: false },
  {
    href: '/admin/members',
    label: 'Members',
    exact: false,
    activePrefixes: ['/admin/credentials'],
    subnav: [
      { href: '/admin/members', label: 'Members' },
      { href: '/admin/members/roster', label: 'Member Roster' },
      { href: '/admin/credentials', label: 'Credentials & Specialty Points' },
    ],
  },
  {
    href: '/admin/personnel',
    label: 'Personnel Changes',
    exact: false,
    subnav: [
      { href: '/admin/personnel', label: 'Personnel lifecycle' },
      { href: '/admin/personnel/operations', label: 'Year-round operations' },
      { href: '/admin/personnel/qualifications', label: 'Qualification Evidence' },
      { href: '/admin/personnel/service-evidence', label: 'Service Evidence' },
      { href: '/admin/personnel/tenure', label: 'Tenure and Protection' },
      { href: '/admin/personnel/obligations', label: 'Post-award Qualifications' },
      { href: '/admin/personnel/reviews', label: 'Qualification Review' },
    ],
  },
  {
    href: '/admin/annual-plan',
    label: 'Prepare Next Bid',
    exact: false,
    activePrefixes: ['/admin/annual-policy'],
    subnav: [
      { href: '/admin/annual-plan', label: 'Annual preparation' },
      { href: '/admin/annual-policy', label: 'Operating policy' },
    ],
  },
  {
    href: '/admin/bid-setup',
    label: 'Bid Setup',
    exact: false,
    activePrefixes: [
      '/admin/rule-books',
      '/admin/positions',
      '/admin/rules',
      '/admin/eligibility',
      '/admin/sessions',
      '/admin/settings/bid-pin',
    ],
    subnav: [
      { href: '/admin/bid-setup', label: 'Bid Configuration' },
      { href: '/admin/annual-plan', label: 'Prepare Next Bid' },
      { href: '/admin/rule-books', label: 'Rule Books' },
      { href: '/admin/positions', label: 'Positions' },
      { href: '/admin/rules', label: 'Rules' },
      { href: '/admin/eligibility', label: 'Eligibility Preview' },
      { href: '/admin/settings/bid-pin', label: 'Bid Access PIN' },
    ],
  },
  { href: '/admin/rehearsal', label: 'Mock Bids', exact: false },
  { href: '/admin/bid', label: 'Live Bid & Advisory', exact: false },
  {
    href: '/admin/audit',
    label: 'Results & Audit',
    exact: false,
    activePrefixes: ['/admin/exports', '/admin/award-transition'],
    subnav: [
      { href: '/admin/audit', label: 'Audit Log' },
      { href: '/admin/exports', label: 'Exports' },
      { href: '/admin/award-transition', label: 'Bid Award Transition' },
    ],
  },
  {
    href: '/admin/system',
    label: 'System/Integrations',
    exact: false,
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

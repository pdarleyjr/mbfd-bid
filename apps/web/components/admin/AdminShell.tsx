'use client';

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
  { href: '/admin/current-rosters', label: 'Current Rosters', exact: false },
  { href: '/admin/telestaff', label: 'TeleStaff', exact: false },
  {
    href: '/admin/members',
    label: 'Members & Credentials',
    exact: false,
    activePrefixes: ['/admin/credentials'],
    subnav: [
      { href: '/admin/members', label: 'Members' },
      { href: '/admin/members/roster', label: 'Member Roster' },
      { href: '/admin/credentials', label: 'Credentials' },
    ],
  },
  {
    href: '/admin/personnel',
    label: 'Personnel Changes',
    exact: false,
    subnav: [
      { href: '/admin/personnel', label: 'Personnel lifecycle' },
      { href: '/admin/personnel/qualifications', label: 'Qualification Evidence' },
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
      { href: '/admin/rule-books', label: 'Rule Books' },
      { href: '/admin/positions', label: 'Positions' },
      { href: '/admin/rules', label: 'Rules' },
      { href: '/admin/eligibility', label: 'Eligibility Preview' },
      { href: '/admin/settings/bid-pin', label: 'Bid Access PIN' },
    ],
  },
  { href: '/admin/ai-assist', label: 'AI Assist', exact: false },
  { href: '/admin/rehearsal', label: 'Mock Bids', exact: false },
  { href: '/admin/bid', label: 'Live Bid', exact: false },
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

export function AdminSideNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-1 p-3">
      <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        Control center
      </p>

      {ADMIN_NAV_LINKS.map((link) => {
        const active = isActive(link, pathname);

        return (
          <div key={link.href}>
            <Link
              href={link.href as Route}
              className={[
                'flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast ease-out-quart',
                active
                  ? 'bg-red-700 text-white'
                  : 'text-slate-200 hover:bg-slate-700 hover:text-white',
              ].join(' ')}
              aria-current={active ? 'page' : undefined}
            >
              {link.label}
            </Link>

            {active && link.subnav && (
              <div className="mt-1 ml-3 flex flex-col gap-1 border-l border-slate-700 pl-2">
                {link.subnav.map((sub) => {
                  const subActive = matchesPath(pathname, sub.href);
                  return (
                    <Link
                      key={sub.href}
                      href={sub.href as Route}
                      className={[
                        'flex min-h-[36px] items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-fast ease-out-quart',
                        subActive
                          ? 'bg-red-700 text-white'
                          : 'text-slate-300 hover:bg-slate-700 hover:text-white',
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

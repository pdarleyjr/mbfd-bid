'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Note: hrefs typed loosely so Plan-05 stub routes (rule-books, sessions/new,
// audit, eligibility) compile before Next's typed-routes generator has run
// against their finished implementations.
const NAV_LINKS: { href: string; label: string; exact: boolean }[] = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/members', label: 'Members', exact: true },
  { href: '/admin/credentials', label: 'Credentials', exact: false },
  { href: '/admin/positions', label: 'Positions', exact: false },
  { href: '/admin/rules', label: 'Rules', exact: false },
  { href: '/admin/rule-books', label: 'Rule Books', exact: false },
  { href: '/admin/sessions/new', label: 'New Session', exact: false },
  { href: '/admin/audit', label: 'Audit Log', exact: false },
  { href: '/admin/eligibility', label: 'Eligibility Preview', exact: false },
  { href: '/admin/rehearsal', label: 'Rehearsal Console', exact: false },
];

// Members sub-navigation — Master Roster + 6 per-station eligibility pages.
// Rendered indented when the current pathname starts with /admin/members.
const MEMBERS_SUBNAV: { href: string; label: string }[] = [
  { href: '/admin/members/roster', label: 'Master Roster' },
  { href: '/admin/members/eligible/marine', label: 'Marine Station' },
  { href: '/admin/members/eligible/trt', label: 'TRT Station 2' },
  { href: '/admin/members/eligible/de', label: 'DE (Driver/Engineer)' },
  { href: '/admin/members/eligible/air-tech', label: 'Air Tech (810)' },
  { href: '/admin/members/eligible/captain-5', label: 'Captain 5' },
  { href: '/admin/members/eligible/days', label: 'Days' },
];

const IMPORT_LINKS = [
  { href: '/admin/members/import' as const, label: 'Import Members' },
  { href: '/admin/credentials/import' as const, label: 'Import Credentials' },
];

export function AdminSideNav() {
  const pathname = usePathname();
  const membersSectionOpen = pathname.startsWith('/admin/members');
  const liveBidActive = pathname === '/admin/bid';

  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-1 p-3">
      {/* Pinned CTA — Live Bid Console. Always visible, visually distinct. */}
      <Link
        href={'/admin/bid' as Route}
        className={[
          'mb-2 flex min-h-[52px] items-center justify-between rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-fast ease-out-quart',
          liveBidActive
            ? 'bg-red-700 text-white ring-2 ring-red-500'
            : 'bg-red-700/80 text-white hover:bg-red-700 hover:ring-2 hover:ring-red-500',
        ].join(' ')}
        aria-current={liveBidActive ? 'page' : undefined}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="text-lg">
            ●
          </span>
          Live Bid Console
        </span>
        <span className="text-xs font-normal opacity-90">Watch live</span>
      </Link>

      {NAV_LINKS.map(({ href, label, exact }) => {
        const isActive = exact
          ? pathname === href
          : pathname.startsWith(href) && pathname !== '/admin';

        const top = (
          <Link
            key={href}
            href={href as Route}
            className={[
              'flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast ease-out-quart',
              isActive
                ? 'bg-red-700 text-white'
                : 'text-slate-200 hover:bg-slate-700 hover:text-white',
            ].join(' ')}
            aria-current={isActive ? 'page' : undefined}
          >
            {label}
          </Link>
        );

        // Expand the Members sub-nav whenever we're under /admin/members.
        if (href === '/admin/members' && membersSectionOpen) {
          return (
            <div key={href}>
              {top}
              <div className="mt-1 ml-3 flex flex-col gap-1 border-l border-slate-700 pl-2">
                {MEMBERS_SUBNAV.map((sub) => {
                  const subActive = pathname === sub.href;
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
            </div>
          );
        }

        return top;
      })}

      <div className="my-3 border-t border-slate-700" />

      {IMPORT_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition-colors duration-fast ease-out-quart hover:bg-slate-700 hover:text-white"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Note: hrefs typed loosely so Plan-05 stub routes (rule-books, sessions/new,
// audit, eligibility) compile before Next's typed-routes generator has run
// against their finished implementations.
const NAV_LINKS: { href: string; label: string; exact: boolean }[] = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/members', label: 'Members', exact: false },
  { href: '/admin/credentials', label: 'Credentials', exact: false },
  { href: '/admin/positions', label: 'Positions', exact: false },
  { href: '/admin/rules', label: 'Rules', exact: false },
  { href: '/admin/rule-books', label: 'Rule Books', exact: false },
  { href: '/admin/sessions/new', label: 'New Session', exact: false },
  { href: '/admin/audit', label: 'Audit Log', exact: false },
  { href: '/admin/eligibility', label: 'Eligibility Preview', exact: false },
  { href: '/admin/rehearsal', label: 'Rehearsal Console', exact: false },
];

const IMPORT_LINKS = [
  { href: '/admin/members/import' as const, label: 'Import Members' },
  { href: '/admin/credentials/import' as const, label: 'Import Credentials' },
];

export function AdminSideNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-1 p-3">
      {NAV_LINKS.map(({ href, label, exact }) => {
        const isActive = exact
          ? pathname === href
          : pathname.startsWith(href) && pathname !== '/admin';

        return (
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

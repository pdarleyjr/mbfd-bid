'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_LINKS = [
  { href: '/admin' as const, label: 'Dashboard', exact: true },
  { href: '/admin/members' as const, label: 'Members', exact: false },
  { href: '/admin/credentials' as const, label: 'Credentials', exact: false },
  { href: '/admin/positions' as const, label: 'Positions', exact: false },
  { href: '/admin/rules' as const, label: 'Rules', exact: false },
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
            href={href}
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

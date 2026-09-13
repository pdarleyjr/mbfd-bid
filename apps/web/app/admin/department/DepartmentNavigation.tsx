'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const destinations = [
  ['/admin/department', 'People'],
  ['/admin/department/roster', 'Roster & Organization'],
  ['/admin/department/credentials', 'Credentials'],
  ['/admin/department/import', 'Import'],
] as const;

export function DepartmentNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Department workspaces"
      className="flex flex-wrap gap-1 border-b border-border pb-2"
    >
      {destinations.map(([href, label]) => (
        <Link
          key={href}
          href={href as Route}
          aria-current={pathname === href ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold ${pathname === href ? 'bg-sidebar text-sidebar-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
